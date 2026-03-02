import type { SlashCommand } from '@anthropic-ai/claude-agent-sdk';
import { readdirSync, readFileSync, realpathSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

let cachedSkills: SlashCommand[] | null = null;

/**
 * Scan ~/.claude/skills/ and return SlashCommand entries parsed from SKILL.md frontmatter.
 * Results are cached after first successful scan.
 */
export function getCustomSkills(): SlashCommand[] {
  if (cachedSkills !== null) return cachedSkills;

  const skillsDir = join(homedir(), '.claude', 'skills');
  const skills: SlashCommand[] = [];

  let entries;
  try {
    entries = readdirSync(skillsDir, { withFileTypes: true });
  } catch {
    cachedSkills = skills;
    return skills;
  }

  for (const entry of entries) {
    try {
      let dirPath: string;

      if (entry.isDirectory()) {
        dirPath = join(skillsDir, entry.name);
      } else if (entry.isSymbolicLink()) {
        // Symlinks-to-directories return false for isDirectory(), resolve to real path
        dirPath = realpathSync(join(skillsDir, entry.name));
      } else {
        continue;
      }

      const skillMdPath = join(dirPath, 'SKILL.md');
      const content = readFileSync(skillMdPath, 'utf-8');
      const parsed = parseFrontmatter(content);

      if (parsed.name) {
        skills.push({
          name: parsed.name,
          description: parsed.description ?? '',
          argumentHint: '',
        });
      }
    } catch {
      // Broken symlink, missing SKILL.md, or unreadable — skip this entry
      continue;
    }
  }

  cachedSkills = skills;
  return skills;
}

/**
 * Parse YAML frontmatter from a SKILL.md file.
 * Handles simple key: value pairs and YAML block scalars (>, >-, >+).
 */
function parseFrontmatter(content: string): Record<string, string> {
  const fmMatch = content.match(/^---\s*\n([\s\S]*?)\n---/);
  if (!fmMatch) return {};

  const lines = fmMatch[1]!.split('\n');
  const result: Record<string, string> = {};
  let currentKey: string | null = null;
  let currentValue: string[] = [];

  for (const line of lines) {
    // Check for a new top-level key (not indented)
    const keyMatch = line.match(/^(\w[\w-]*)\s*:\s*(.*)/);

    if (keyMatch && !line.match(/^\s/)) {
      // Flush previous key
      if (currentKey !== null) {
        result[currentKey] = currentValue.join(' ').trim();
      }

      currentKey = keyMatch[1]!;
      const rawValue = keyMatch[2]!.trim();

      // Block scalar indicator (>, >-, >+) means value continues on indented lines
      if (/^>[+-]?\s*$/.test(rawValue)) {
        currentValue = [];
      } else {
        currentValue = [rawValue];
      }
    } else if (currentKey !== null && /^\s+/.test(line)) {
      // Continuation line (indented) — part of current value
      currentValue.push(line.trim());
    }
  }

  // Flush last key
  if (currentKey !== null) {
    result[currentKey] = currentValue.join(' ').trim();
  }

  return result;
}
