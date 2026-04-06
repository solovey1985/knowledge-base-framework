import * as path from 'path';
import * as fs from 'fs/promises';
import express from 'express';
import { KnowledgeBase, StaticSiteBuilder, KnowledgeBaseOptions } from '../index';
import { ConfigError, loadConfigFile } from './configLoader';

const templatesDir = path.join(__dirname, '..', 'service-templates');

/**
 * Simple template renderer for {{TOKEN}} replacement
 */
async function renderTemplate(templateName: string, tokens: Record<string, string | number>): Promise<string> {
    const templatePath = path.join(templatesDir, templateName);
    const tplRaw = await fs.readFile(templatePath, 'utf-8');
    let tpl = tplRaw;
    for (const [key, value] of Object.entries(tokens)) {
        const token = new RegExp(`\\{\\{${key}\\}\\}`, 'g');
        tpl = tpl.replace(token, String(value));
    }
    return tpl;
}

async function main() {
    const args = process.argv.slice(2);
    const command = args[0];

    switch (command) {
        case 'init':
            await initProject(args[1]);
            break;
        case 'serve':
            await serveProject(args);
            break;
        case 'build':
            await buildProject(args);
            break;
        case 'help':
        default:
            showHelp();
            break;
    }
}

async function initProject(projectName?: string): Promise<void> {
    const name = projectName || 'my-knowledge-base';
    const projectDir = path.resolve(name);

    console.log(`🚀 Creating knowledge base project: ${name}`);

    // Create project directories
    await fs.mkdir(projectDir, { recursive: true });
    const contentDir = path.join(projectDir, 'content');
    await fs.mkdir(contentDir, { recursive: true });
    await fs.mkdir(path.join(contentDir, 'guides'), { recursive: true });

    // Copy content templates as-is (no token replacement)
    const indexTplPath = path.join(templatesDir, 'content', 'index.template.md');
    const indexRaw = await fs.readFile(indexTplPath, 'utf-8');
    await fs.writeFile(path.join(contentDir, 'index.md'), indexRaw);

    const guideTplPath = path.join(templatesDir, 'content', 'guides', 'getting-started.template.md');
    const guideRaw = await fs.readFile(guideTplPath, 'utf-8');
    await fs.writeFile(path.join(contentDir, 'guides', 'getting-started.md'), guideRaw);

    // Create package.json from template (render tokens)
    const packageTokens = {
        PROJECT_NAME: name,
        VERSION: '1.0.0',
        DESCRIPTION: `${name} - A comprehensive knowledge base`,
        FRAMEWORK_VERSION: '^1.0.0',
        EXPRESS_VERSION: '^4.18.2',
        NODEMON_VERSION: '^3.0.1'
    } as Record<string, string | number>;

    const packageTpl = await renderTemplate('package.template.json', packageTokens as any);
    const packageObj = JSON.parse(packageTpl);
    await fs.writeFile(path.join(projectDir, 'package.json'), JSON.stringify(packageObj, null, 2));

    const configTpl = await renderTemplate('kb.config.template.json', { PROJECT_NAME: name } as any);
    await fs.writeFile(path.join(projectDir, 'kb.config.json'), configTpl);

    const gitignoreTemplate = await fs.readFile(path.join(templatesDir, '.gitignore.template'), 'utf-8');
    await fs.writeFile(path.join(projectDir, '.gitignore'), gitignoreTemplate);

    // Render and write server, build and README
    const tokens = { PROJECT_NAME: name, PORT: 3000, ASSETS_URL: '/assets', ASSETS_DIR: 'assets' } as Record<string, string | number>;

    const serverTpl = await renderTemplate('server.template.js', tokens);
    await fs.writeFile(path.join(projectDir, 'server.js'), serverTpl);

    const buildTpl = await renderTemplate('build.template.js', tokens);
    await fs.writeFile(path.join(projectDir, 'build.js'), buildTpl);

    const readmeTpl = await renderTemplate('README.template.md', { PROJECT_NAME: name } as any);
    await fs.writeFile(path.join(projectDir, 'README.md'), readmeTpl);

    console.log('✅ Project created successfully!');
    console.log('\nNext steps:');
    console.log(`  cd ${name}`);
    console.log('  npm install');
    console.log('  npm start');
    console.log('\nEdit kb.config.json to customize your site title, paths, and build output.');
}

async function serveProject(args: string[]): Promise<void> {
    try {
        const { config } = await loadConfigFile();

        const app = express();
        const kb = new KnowledgeBase({ ...config, contentRootPath: path.resolve(config.contentRootPath) });

        kb.setupMiddleware(app);

        const port = config.server?.port || 3000;
        app.listen(port, () => {
            console.log(`📚 Knowledge Base running at http://localhost:${port}`);
        });
    } catch (error) {
        handleConfigError(error);
    }
}

async function buildProject(args: string[]): Promise<void> {
    try {
        const { config } = await loadConfigFile();

        const builder = new StaticSiteBuilder({ ...config, contentRootPath: path.resolve(config.contentRootPath), isStaticSite: true });
        await builder.build();
    } catch (error) {
        handleConfigError(error);
    }
}

function handleConfigError(error: unknown): void {
    if (error instanceof ConfigError) {
        console.error(`❌ ${error.message}`);
        process.exitCode = 1;
        return;
    }

    console.error('❌ Unexpected error while processing configuration:', error);
    process.exitCode = 1;
}

function showHelp(): void {
    console.log(`
Knowledge Base Framework CLI

Usage:
    kb <command> [options]

Commands:
    init [name]     Create a new knowledge base project
    serve           Start development server  
    build           Build static site
    help            Show this help message

Examples:
    kb init my-docs
    kb serve
    kb build
`);
}

if (require.main === module) {
    main().catch(console.error);
}
