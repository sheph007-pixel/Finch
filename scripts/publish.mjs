import { execSync } from 'node:child_process';

const run = (cmd, allowFail = false) => {
  try {
    return execSync(cmd, { stdio: 'pipe', encoding: 'utf8' }).trim();
  } catch (error) {
    if (allowFail) return '';
    const stderr = error?.stderr?.toString?.() || error.message;
    throw new Error(`Command failed: ${cmd}\n${stderr}`);
  }
};

const env = process.env;
const currentBranch = run('git branch --show-current');

const maybeCreateGitHubRepo = () => {
  const owner = env.GITHUB_OWNER;
  const repo = env.GITHUB_REPO;
  const token = env.GITHUB_TOKEN;
  if (!owner || !repo || !token) return;

  const checkCmd = `curl -sS -o /tmp/github_repo_check.json -w '%{http_code}' -H 'Authorization: Bearer ${token}' -H 'Accept: application/vnd.github+json' https://api.github.com/repos/${owner}/${repo}`;
  const status = run(checkCmd, true);

  if (status === '200') return;

  const visibility = (env.GITHUB_PRIVATE || 'true').toLowerCase() === 'true';
  const createAsOrg = (env.GITHUB_CREATE_AS_ORG || 'false').toLowerCase() === 'true';
  const endpoint = createAsOrg
    ? `https://api.github.com/orgs/${owner}/repos`
    : 'https://api.github.com/user/repos';

  const createCmd = `curl -sS -o /tmp/github_repo_create.json -w '%{http_code}' -X POST -H 'Authorization: Bearer ${token}' -H 'Accept: application/vnd.github+json' ${endpoint} -d '{"name":"${repo}","private":${visibility}}'`;
  const createStatus = run(createCmd, true);
  if (createStatus !== '201') {
    const body = run('cat /tmp/github_repo_create.json', true);
    throw new Error(`Failed to create GitHub repo ${owner}/${repo}. HTTP ${createStatus}. Response: ${body}`);
  }
};

const ensureRemote = () => {
  const existing = run('git remote get-url origin', true);
  if (existing) return existing;

  const explicit = env.GITHUB_REPO_URL;
  if (explicit) {
    run(`git remote add origin ${explicit}`);
    return explicit;
  }

  const owner = env.GITHUB_OWNER;
  const repo = env.GITHUB_REPO;
  const token = env.GITHUB_TOKEN;
  if (owner && repo && token) {
    maybeCreateGitHubRepo();
    const authed = `https://${token}@github.com/${owner}/${repo}.git`;
    run(`git remote add origin ${authed}`);
    return authed;
  }

  throw new Error(
    'No origin remote. Provide GITHUB_REPO_URL or GITHUB_OWNER+GITHUB_REPO+GITHUB_TOKEN.'
  );
};

const ensureMainContainsCurrent = () => {
  const hasMain = run('git show-ref --verify --quiet refs/heads/main; echo $?', true) === '0';
  if (!hasMain) {
    run(`git branch main ${currentBranch}`);
  } else {
    run('git branch -f main HEAD');
  }
};

const remote = ensureRemote();
ensureMainContainsCurrent();

console.log(`Current branch: ${currentBranch}`);
console.log(`Origin: ${remote}`);

console.log('Pushing main and current branch to GitHub...');
run('git push -u origin main');
run(`git push -u origin ${currentBranch}`);

const vercelToken = env.VERCEL_TOKEN;
if (!vercelToken) {
  throw new Error('Missing VERCEL_TOKEN environment variable.');
}

const vercelFlags = [
  '--prod',
  '--yes',
  `--token ${vercelToken}`,
  env.VERCEL_SCOPE ? `--scope ${env.VERCEL_SCOPE}` : '',
  env.VERCEL_PROJECT ? `--name ${env.VERCEL_PROJECT}` : ''
].filter(Boolean).join(' ');

console.log('Deploying to Vercel production...');
const vercelOutput = run(`npx vercel deploy ${vercelFlags}`);
const deploymentUrl = vercelOutput
  .split('\n')
  .map((line) => line.trim())
  .find((line) => line.startsWith('https://'));

if (!deploymentUrl) {
  throw new Error(`Could not parse deployment URL from vercel output:\n${vercelOutput}`);
}

console.log(`Deployment URL: ${deploymentUrl}`);
console.log('Running live smoke checks...');
run(`curl -fsS ${deploymentUrl}/ > /dev/null`);
run(`curl -fsS ${deploymentUrl}/signup > /dev/null`);
run(`curl -fsS ${deploymentUrl}/login > /dev/null`);
run(`curl -fsS -X POST ${deploymentUrl}/api/signup -H 'Content-Type: application/json' -d '{"fullName":"Live User","companyName":"Live Co","email":"live@example.com","password":"pw"}' > /dev/null`);

console.log('Publish complete and smoke checks passed.');
