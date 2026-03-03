import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

// Kept for reference/logging — NOT used as a gate in expansion.
// Custom skills/commands with these names will still override them.
const BUILTIN_COMMANDS = new Set([
  'help', 'clear', 'compact', 'cost', 'model', 'status',
  'review', 'bug', 'init', 'config', 'memory', 'permissions',
]);

// Matches /command anywhere — must be at start of text or after whitespace.
// Only matches the FIRST occurrence (non-global).
const SLASH_CMD_RE = /(?:^|\s)(\/([a-zA-Z][a-zA-Z0-9:-]*))/;

export interface SlashCommandMatch {
  name: string;
  args: string;
  prefix: string;
}

export function findSlashCommand(text: string): SlashCommandMatch | null {
  const match = text.match(SLASH_CMD_RE);
  if (!match) return null;

  const slashWithName = match[1]!; // "/command-name"
  const name = match[2]!;
  const cmdStart = match.index! + match[0].indexOf('/');

  const prefix = text.slice(0, cmdStart);
  const afterCmd = text.slice(cmdStart + slashWithName.length);
  const args = afterCmd.replace(/^\s+/, '');

  return { name, args, prefix };
}

export function expandSlashCommand(
  text: string,
  repoPath: string,
): { expanded: string; name: string; args: string } | null {
  const cmd = findSlashCommand(text);
  if (!cmd) return null;

  const content = loadSkillContent(cmd.name, repoPath);
  if (!content) {
    console.log(`[slash-expand] detected /${cmd.name} but no expansion found`);
    return null;
  }

  const stripped = stripFrontmatter(content);
  const withArgs = stripped.replaceAll('$ARGUMENTS', cmd.args);
  const expanded = cmd.prefix ? `${cmd.prefix.trimEnd()} ${withArgs}` : withArgs;

  console.log(`[slash-expand] /${cmd.name} → expanded (${expanded.length} chars)`);

  return { expanded, name: cmd.name, args: cmd.args };
}

function loadSkillContent(name: string, repoPath: string): string | null {
  const home = homedir();
  const candidates = [
    join(repoPath, '.claude', 'commands', `${name}.md`),
    join(repoPath, '.claude', 'skills', name, 'SKILL.md'),
    join(home, '.claude', 'commands', `${name}.md`),
    join(home, '.claude', 'skills', name, 'SKILL.md'),
  ];

  for (const path of candidates) {
    try {
      return readFileSync(path, 'utf-8');
    } catch {
      continue;
    }
  }
  return null;
}

function stripFrontmatter(content: string): string {
  // Strip UTF-8 BOM
  const clean = content.charCodeAt(0) === 0xfeff ? content.slice(1) : content;

  const match = clean.match(/^---\s*\n[\s\S]*?\n---\s*\n?/);
  if (!match) return clean;

  return clean.slice(match[0].length);
}
