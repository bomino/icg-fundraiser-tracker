import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const STEP_NAME = 'Check the repository variables';
const SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbx_Example-123/exec';
const CLIENT_ID = '123456789012-abcdefghijklmnopqrstuvwxyz012345.apps.googleusercontent.com';

const workflow = readFileSync(new URL('../.github/workflows/pages.yml', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const indentOf = (line: string) => line.search(/\S/);

function stepLines(name: string): string[] {
  const lines = workflow.split('\n');
  const start = lines.findIndex((line) => line.trim() === `- name: ${name}`);
  if (start < 0) throw new Error(`pages.yml has no "${name}" step.`);
  const end = lines.findIndex((line, index) => index > start && line.trim() !== '' && indentOf(line) <= indentOf(lines[start]));
  return lines.slice(start, end < 0 ? undefined : end);
}

// The step's `run: |` block, dedented, which is the whole script the runner hands to bash.
function runScript(step: string[]): string {
  const body = step.slice(step.findIndex((line) => line.trim() === 'run: |') + 1);
  const indent = Math.min(...body.filter((line) => line.trim() !== '').map(indentOf));
  return body.map((line) => line.slice(indent)).join('\n');
}

// GitHub's Linux runner uses bash. On Windows `bash` is often WSL's, which never sees this
// process's environment, so there the script is only run from a Git Bash prompt.
const bashReadsEnv = spawnSync('bash', ['-c', 'printf %s "$PROBE"'], { env: { ...process.env, PROBE: 'ok' }, encoding: 'utf8' }).stdout === 'ok';

function check(scriptUrl: string, clientId: string) {
  const result = spawnSync('bash', ['-e', '-c', runScript(stepLines(STEP_NAME))], {
    env: { ...process.env, VITE_SCRIPT_URL: scriptUrl, VITE_GOOGLE_CLIENT_ID: clientId },
    encoding: 'utf8',
  });
  return { status: result.status, errors: result.stdout.split('\n').filter((line) => line.startsWith('::error::')) };
}

describe('the deploy workflow', () => {
  it('checks both repository variables before a non-pull-request build uploads the site', () => {
    const step = stepLines(STEP_NAME);
    expect(step).toContain("        if: github.event_name != 'pull_request'");
    expect(step).toContain('          VITE_SCRIPT_URL: ${{ vars.VITE_SCRIPT_URL }}');
    expect(step).toContain('          VITE_GOOGLE_CLIENT_ID: ${{ vars.VITE_GOOGLE_CLIENT_ID }}');
    const deployJob = workflow.indexOf('\n  deploy:');
    const checkAt = workflow.indexOf(`- name: ${STEP_NAME}`);
    expect(checkAt).toBeLessThan(workflow.indexOf('uses: actions/upload-pages-artifact'));
    expect(workflow.indexOf('uses: actions/upload-pages-artifact')).toBeLessThan(deployJob);
    expect(workflow.slice(deployJob)).toContain('needs: build');
  });

  it('installs with --engine-strict in both jobs, so a runner below the Node floor in package.json fails instead of warning', () => {
    const installs = workflow.split('\n').filter((line) => /\bnpm (ci|install)\b/.test(line));
    expect(installs.map((line) => line.trim())).toEqual(['- run: npm ci --engine-strict', '- run: npm ci --engine-strict']);
  });
});

describe.skipIf(!bashReadsEnv)('the repository variables check', () => {
  it.each([
    ['a personal account’s', SCRIPT_URL],
    ['a Google Workspace account’s', 'https://script.google.com/a/macros/example.org/s/AKfycbx_Example-123/exec'],
  ])('passes %s /exec URL', (_label, scriptUrl) => {
    expect(check(scriptUrl, CLIENT_ID)).toEqual({ status: 0, errors: [] });
  });

  it.each([
    ['missing', ''],
    ['the /dev test URL', 'https://script.google.com/macros/s/AKfycbx_Example-123/dev'],
    ['the editor’s address', 'https://script.google.com/home/projects/1AbCdEf/edit'],
    ['pasted with a space after it', `${SCRIPT_URL} `],
    ['the client ID', CLIENT_ID],
  ])('stops the deploy when VITE_SCRIPT_URL is %s', (_label, scriptUrl) => {
    const { status, errors } = check(scriptUrl, CLIENT_ID);
    expect(status).toBe(1);
    expect(errors[0]).toMatch(/VITE_SCRIPT_URL.*docs\/SETUP\.md, step \d\.\d/);
    expect(errors.some((line) => line.includes('VITE_GOOGLE_CLIENT_ID'))).toBe(false);
  });

  it.each([
    ['missing', ''],
    ['pasted with a space after it', `${CLIENT_ID} `],
    ['pasted with a line break after it', `${CLIENT_ID}\n`],
    ['the /exec URL', SCRIPT_URL],
    ['cut short', '123456789012-abcdefghijklmnopqrstuvwxyz012345'],
  ])('stops the deploy when VITE_GOOGLE_CLIENT_ID is %s', (_label, clientId) => {
    const { status, errors } = check(SCRIPT_URL, clientId);
    expect(status).toBe(1);
    expect(errors[0]).toMatch(/VITE_GOOGLE_CLIENT_ID.*docs\/SETUP\.md, step \d\.\d/);
    expect(errors.some((line) => line.includes('VITE_SCRIPT_URL'))).toBe(false);
  });

  it('reports both variables in one run, and that the live site was left alone', () => {
    const { status, errors } = check('', '');
    expect(status).toBe(1);
    expect(errors).toEqual([expect.stringContaining('VITE_SCRIPT_URL'), expect.stringContaining('VITE_GOOGLE_CLIENT_ID'), expect.stringContaining('live site')]);
  });
});
