import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

// Kept for reference/logging — NOT used as a gate in expansion.
// Custom skills/commands with these names will still override them.
const BUILTIN_COMMANDS = new Set([
  'help', 'clear', 'compact', 'cost', 'model', 'status',
  'review', 'bug', 'init', 'config', 'memory', 'permissions',
]);

const SLASH_COMMAND_RE = /^\/([a-zA-Z][a-zA-Z0-9:-]*)(?:\s+([\s\S]*))?$/;

export function expandSlashCommand(
  text: string,
  repoPath: string,
): { expanded: string; name: string; args: string } | null {
  const match = text.match(SLASH_COMMAND_RE);
  if (!match) return null;

  const name = match[1]!;
  const args = match[2] ?? '';

  const content = loadSkillContent(name, repoPath);
  if (!content) {
    console.log(`[slash-expand] detected /${name} but no expansion found`);
    return null;
  }

  const stripped = stripFrontmatter(content);
  const expanded = stripped.replaceAll('$ARGUMENTS', args);

  console.log(`[slash-expand] /${name} → expanded (${expanded.length} chars)`);

  return { expanded, name, args };
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
