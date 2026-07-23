const fs = require('fs');
const path = require('path');

const cwd = process.cwd();
const lockfiles = ['package-lock.json', 'yarn.lock'];
for (const file of lockfiles) {
  const filePath = path.join(cwd, file);
  if (fs.existsSync(filePath)) {
    try {
      fs.unlinkSync(filePath);
    } catch (error) {
      console.error(`Failed to remove ${file}:`, error);
      process.exitCode = 1;
    }
  }
}

const userAgent = process.env.npm_config_user_agent || '';
if (!userAgent.startsWith('pnpm/')) {
  console.error('Use pnpm instead');
  process.exit(1);
}
