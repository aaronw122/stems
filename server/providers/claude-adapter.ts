import { query, AbortError } from '@anthropic-ai/claude-agent-sdk';
import type {
  Query,
  Options,
  SlashCommand,
  SDKSystemMessage,
  SDKUserMessage,
  SDKMessage,
} from '@anthropic-ai/claude-agent-sdk';
import { execSync } from 'node:child_process';
import type { ImageAttachment, ProviderId } from '../../shared/types.ts';
import { resolveResumeCompatibility } from '../provider-metadata.ts';
import { broadcastTerminal } from '../state.ts';

export type ClaudeQuery = Query;
export type ClaudeMessage = SDKMessage;
export type ClaudeSlashCommand = SlashCommand;
export type ClaudeSessionOptions = Omit<Options, 'abortController' | 'resume'>;

// Content block types for building multimodal prompts (matches Anthropic SDK MessageParam)
type ImageMediaType = 'image/png' | 'image/jpeg' | 'image/gif' | 'image/webp';

interface ImageContentBlock {
  type: 'image';
  source: {
    type: 'base64';
    media_type: ImageMediaType;
    data: string;
  };
}

interface TextContentBlock {
  type: 'text';
  text: string;
}

type ContentBlock = ImageContentBlock | TextContentBlock;

interface ClaudeInitBannerData {
  claudeCodeVersion: string;
  rawModel: string;
  cwd: string;
}

export interface ClaudeInitParseResult {
  sessionId: string | null;
  resumeToken: string | null;
}

function resolveSystemClaudePath(): string | undefined {
  try {
    return execSync('which claude', { encoding: 'utf-8' }).trim() || undefined;
  } catch {
    return undefined;
  }
}

const claudePath = resolveSystemClaudePath();

// Strip CLAUDECODE markers so child Claude processes don't refuse to start.
// Map STEMS_OAUTH_TOKEN into CLAUDE_CODE_OAUTH_TOKEN for subscription billing.
export function buildClaudeEnv(env: NodeJS.ProcessEnv = process.env): Record<string, string | undefined> {
  const {
    CLAUDECODE,
    CLAUDE_CODE_ENTRYPOINT,
    STEMS_OAUTH_TOKEN,
    ...clean
  } = env;

  if (STEMS_OAUTH_TOKEN) {
    clean.CLAUDE_CODE_OAUTH_TOKEN = STEMS_OAUTH_TOKEN;
  }

  return clean;
}

function buildClaudeImagePrompt(
  text: string,
  images: ImageAttachment[],
  resumeToken: string | null,
): AsyncIterable<SDKUserMessage> {
  const content: ContentBlock[] = [];

  for (const img of images) {
    content.push({
      type: 'image',
      source: {
        type: 'base64',
        media_type: img.mediaType as ImageMediaType,
        data: img.data,
      },
    });
  }

  if (text) {
    content.push({ type: 'text', text });
  }

  return (async function* () {
    yield {
      type: 'user' as const,
      message: { role: 'user' as const, content } as SDKUserMessage['message'],
      parent_tool_use_id: null,
      session_id: resumeToken ?? '',
    };
  })();
}

function parseInitBannerData(msg: SDKSystemMessage): ClaudeInitBannerData {
  return {
    claudeCodeVersion: typeof msg.claude_code_version === 'string' ? msg.claude_code_version : '',
    rawModel: typeof msg.model === 'string' ? msg.model : '',
    cwd: typeof msg.cwd === 'string' ? msg.cwd : '',
  };
}

function isSystemInitMessage(msg: ClaudeMessage): msg is SDKSystemMessage {
  return msg.type === 'system' && 'subtype' in msg && msg.subtype === 'init';
}

export function createClaudeBaseOptions(
  repoPath: string,
  appendSystemPrompt?: string,
): ClaudeSessionOptions {
  return {
    cwd: repoPath,
    model: 'claude-opus-4-6',
    permissionMode: 'bypassPermissions',
    allowDangerouslySkipPermissions: true,
    includePartialMessages: true,
    // SDK defaults to isolation mode unless settingSources is set explicitly.
    // Include all standard sources so global + project CLAUDE.md files load.
    settingSources: ['user', 'project', 'local'],
    pathToClaudeCodeExecutable: claudePath,
    env: buildClaudeEnv(),
    // Always use the claude_code preset so sessions load full Claude context.
    systemPrompt: appendSystemPrompt
      ? { type: 'preset', preset: 'claude_code', append: appendSystemPrompt }
      : { type: 'preset', preset: 'claude_code' },
  };
}

export function createClaudeTurnQuery(args: {
  baseOptions: ClaudeSessionOptions;
  abortController: AbortController;
  prompt: string;
  images?: ImageAttachment[];
  resumeToken: string | null;
}): ClaudeQuery {
  const { baseOptions, abortController, prompt, images, resumeToken } = args;

  let options: Options = {
    ...baseOptions,
    abortController,
  };

  if (resumeToken) {
    const { systemPrompt: _unused, ...withoutSystemPrompt } = options;
    options = {
      ...withoutSystemPrompt,
      resume: resumeToken,
    };
  }

  const effectivePrompt = images && images.length > 0
    ? buildClaudeImagePrompt(prompt, images, resumeToken)
    : prompt;

  return query({ prompt: effectivePrompt, options });
}

export function handleClaudeInitMessage(args: {
  nodeId: string;
  providerId: ProviderId;
  legacySessionId: string | null;
  msg: ClaudeMessage;
  queryInstance: ClaudeQuery;
  onSlashCommands: (commands: ClaudeSlashCommand[]) => void;
}): ClaudeInitParseResult | null {
  const {
    nodeId,
    providerId,
    legacySessionId,
    msg,
    queryInstance,
    onSlashCommands,
  } = args;

  if (!isSystemInitMessage(msg)) {
    return null;
  }

  const resumeCompat = resolveResumeCompatibility(providerId, msg.session_id, legacySessionId);

  void queryInstance.initializationResult().then(async (initResult) => {
    onSlashCommands(initResult.commands);
    console.log(`[session:${nodeId}] captured ${initResult.commands.length} slash commands`);

    const { claudeCodeVersion, rawModel, cwd } = parseInitBannerData(msg);
    const activeModel = initResult.models.find((model) => model.value === rawModel);
    const displayName = activeModel?.displayName ?? rawModel;

    const { checkForUpdate } = await import('../version-check.ts');
    const upgrade = await checkForUpdate(claudeCodeVersion);

    broadcastTerminal(nodeId, [{
      type: 'session_banner',
      text: '',
      bannerData: {
        claudeCodeVersion,
        model: rawModel,
        modelDisplayName: displayName,
        subscriptionType: initResult.account?.subscriptionType,
        cwd,
        upgradeAvailable: upgrade.available,
        latestVersion: upgrade.latest,
      },
    }]);

    console.log(`[session:${nodeId}] emitted session_banner: ${displayName}, ${initResult.account?.subscriptionType ?? 'unknown plan'}`);
  }).catch((err) => {
    console.warn(`[session:${nodeId}] failed to build session banner:`, err);
  });

  return {
    sessionId: resumeCompat.sessionId,
    resumeToken: resumeCompat.resumeToken,
  };
}

export async function generateClaudeFeatureTitle(
  userMessage: string,
  repoPath: string,
): Promise<string | null> {
  const titleQuery = query({
    prompt: `In exactly 2-3 words, name the feature or task described below. Output ONLY the title, nothing else. No quotes, no punctuation, no explanation. Maximum 3 words.\n\n${userMessage}`,
    options: {
      cwd: repoPath,
      permissionMode: 'bypassPermissions',
      allowDangerouslySkipPermissions: true,
      pathToClaudeCodeExecutable: claudePath,
      env: buildClaudeEnv(),
    },
  });

  let responseText = '';
  for await (const msg of titleQuery) {
    if (
      msg.type === 'assistant'
      && msg.message?.content
      && Array.isArray(msg.message.content)
    ) {
      for (const block of msg.message.content) {
        if (block.type === 'text' && 'text' in block) {
          responseText += String(block.text);
        }
      }
    }
  }

  const title = responseText.trim().replace(/^["']|["']$/g, '');
  return title || null;
}

export { AbortError as ClaudeAbortError };
