import { execInContainer } from './dockerService';

const CONTAINER_NAME = process.env.CLAUDE_CONTAINER || 'ai-claude';

// git diff ignores untracked files, so files Claude created from scratch
// are diffed against /dev/null separately
const WORKING_DIFF_CMD =
  'git diff; git ls-files --others --exclude-standard | ' +
  'while IFS= read -r f; do git diff --no-index -- /dev/null "$f"; done; true';

/** Uncommitted changes, including untracked files. Empty string when clean. */
export async function workingDiff(projectName: string): Promise<string> {
  return execInContainer(CONTAINER_NAME, `cd /workspace/${projectName} && ${WORKING_DIFF_CMD}`);
}
