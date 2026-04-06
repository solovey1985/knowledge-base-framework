import { cp, rm } from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

const sourceDir = path.join(rootDir, 'src', 'service-templates');
const destinationDir = path.join(rootDir, 'lib', 'service-templates');

async function copyTemplates() {
  await rm(destinationDir, { recursive: true, force: true });
  await cp(sourceDir, destinationDir, { recursive: true });
  console.log('📁 Copied service templates');
}

copyTemplates().catch(error => {
  console.error('Failed to copy service templates:', error);
  process.exitCode = 1;
});
