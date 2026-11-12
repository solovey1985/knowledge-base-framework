#!/usr/bin/env node
import * as path from 'path';
import * as fs from 'fs/promises';
import { existsSync } from 'fs';
import { spawnSync } from 'child_process';
import frameworkPackage from '../../package.json';
import { buildSite, startServer } from '../index';
import { ConfigError, loadConfigFile } from './configLoader';

const templatesDir = path.join(__dirname, '..', 'service-templates');
const FRAMEWORK_VERSION = `^${frameworkPackage.version}`;
const EXPRESS_VERSION = '^4.18.2';
const NODEMON_VERSION = '^3.0.1';

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
        case 'update':
            await updateProject();
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
        FRAMEWORK_VERSION,
        EXPRESS_VERSION,
        NODEMON_VERSION
    } as Record<string, string | number>;

    const packageTpl = await renderTemplate('package.template.json', packageTokens as any);
    const packageObj = JSON.parse(packageTpl);
    await fs.writeFile(path.join(projectDir, 'package.json'), JSON.stringify(packageObj, null, 2));

    const configTpl = await renderTemplate('kb.config.template.json', { PROJECT_NAME: name } as any);
    await fs.writeFile(path.join(projectDir, 'kb.config.json'), configTpl);

    const pluginsTpl = await fs.readFile(path.join(templatesDir, 'kb.plugins.template.json'), 'utf-8');
    await fs.writeFile(path.join(projectDir, 'kb.plugins.json'), pluginsTpl);

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

    await copyFrameworkAssets(projectDir, 'assets');

    console.log('✅ Project created successfully!');
    console.log('\nNext steps:');
    console.log(`  cd ${name}`);
    console.log('  npm install');
    console.log('  npm start');
    console.log('\nEdit kb.config.json to customize your site title, paths, and build output.');
    console.log('Run `kb update` later to refresh server/build files after upgrading the framework.');
}

async function updateProject(): Promise<void> {
    try {
        const projectDir = process.cwd();
        const { config } = await loadConfigFile();

        const packagePath = path.join(projectDir, 'package.json');
        const packageRaw = await fs.readFile(packagePath, 'utf-8');
        const packageJson = JSON.parse(packageRaw);

        console.log('=== Update Configuration ===');
        console.log(`  Project name:    ${packageJson.name}`);
        console.log(`  Project dir:     ${projectDir}`);
        console.log(`  Server port:     ${config.server?.port || 3000}`);
        console.log(`  Framework ver:   ${FRAMEWORK_VERSION}`);
        console.log('===========================');
        console.log('🔄 Updating project files...');

        // The global CLI and project runtime must use the same published version.
        const packageName = '@solovey1985/knowledge-base-framework';
        const targetVersion = frameworkPackage.version;
        const installedPath = path.join(projectDir, 'node_modules', packageName, 'package.json');
        const installedVersion = existsSync(installedPath)
            ? JSON.parse(await fs.readFile(installedPath, 'utf-8')).version : undefined;
        if (installedVersion !== targetVersion || packageJson.dependencies?.[packageName] !== targetVersion) {
            if (!/^[0-9]+\.[0-9]+\.[0-9]+(?:-[a-zA-Z0-9.-]+)?$/.test(targetVersion)) {
                throw new Error('Invalid framework version');
            }
            const result = spawnSync('npm', ['install', '--save-exact', `${packageName}@${targetVersion}`], {
                cwd: projectDir, stdio: 'inherit', shell: process.platform === 'win32'
            });
            if (result.error || result.status !== 0) throw new Error('Unable to update the project framework dependency');
        }

        const tokens = {
            PROJECT_NAME: packageJson.name,
            PORT: config.server?.port || 3000,
            ASSETS_URL: '/assets',
            ASSETS_DIR: 'assets'
        } as Record<string, string | number>;

        if (!config.server?.entrypoint) {
            await fs.writeFile(path.join(projectDir, 'server.js'), await renderTemplate('server.template.js', tokens));
            console.log('  ✔ server.js');
            await fs.writeFile(path.join(projectDir, 'build.js'), await renderTemplate('build.template.js', tokens));
            console.log('  ✔ build.js');
            await fs.writeFile(path.join(projectDir, 'README.md'), await renderTemplate('README.template.md', { PROJECT_NAME: packageJson.name }));
            console.log('  ✔ README.md');
        } else {
            console.log('  ✔ Preserved project-owned server.js, build.js and README.md (server.entrypoint configured)');
        }

        const pluginsConfigPath = path.join(projectDir, config.pluginsConfigPath || 'kb.plugins.json');
        try {
            await fs.access(pluginsConfigPath);
        } catch {
            const pluginsTpl = await fs.readFile(path.join(templatesDir, 'kb.plugins.template.json'), 'utf-8');
            await fs.writeFile(pluginsConfigPath, pluginsTpl);
            console.log(`  ✔ ${path.basename(pluginsConfigPath)}`);
        }

        await copyFrameworkAssets(projectDir, 'assets');
        console.log('  ✔ assets/');

        console.log('✅ Project files updated. Review git changes before committing.');
    } catch (error) {
        handleConfigError(error);
    }
}

async function serveProject(args: string[]): Promise<void> {
    try {
        const flags = parseFlags(args, ['config', 'port', 'host', 'plugins']);
        if (flags.port && !/^\d{1,5}$/.test(flags.port)) throw new ConfigError('Option --port needs a number.');
        const { config, path: configPath } = await loadConfigFile(flags.config);
        // An explicit project entrypoint can prepare local credentials and plugins
        // before the standard plugin loader runs. Never auto-discover executable files.
        if (config.server?.entrypoint) {
            const entrypoint = path.resolve(path.dirname(configPath), config.server.entrypoint);
            const application = require(entrypoint) as { startServer?: () => unknown };
            if (typeof application.startServer !== 'function') {
                throw new Error('server.entrypoint must export startServer()');
            }
            await application.startServer();
            return;
        }
        startServer({
            configPath,
            pluginsConfigPath: flags.plugins,
            port: flags.port ? Number(flags.port) : undefined,
            host: flags.host
        });
    } catch (error) {
        handleConfigError(error);
    }
}

async function buildProject(args: string[]): Promise<void> {
    try {
        const flags = parseFlags(args, ['config', 'plugins']);
        const { config, path: configPath } = await loadConfigFile(flags.config);
        const isGitHubBuild = config.build?.target === 'github';
        const resolvedContentRoot = path.resolve(config.contentRootPath);
        const effectiveBaseUrl = config.baseUrl || '';

        console.log('=== Build Configuration ===');
        console.log(`  Build target:    ${isGitHubBuild ? 'GitHub Pages' : 'local'}`);
        console.log(`  Base URL:        "${effectiveBaseUrl}"`);
        console.log(`  Content root:    ${resolvedContentRoot}`);
        console.log(`  Output dir:      ${config.build?.outputDir || '(default)'}`);
        console.log(`  Clean build:     ${config.build?.clean ?? '(default)'}`);
        console.log(`  Search enabled:  ${config.search?.enabled ?? '(default)'}`);
        console.log('===========================');

        await buildSite({ configPath, pluginsConfigPath: flags.plugins });
    } catch (error) {
        handleConfigError(error);
    }
}

/** --name value and --name=value; unknown flags are rejected so typos are not ignored. */
function parseFlags(args: string[], allowed: string[]): Record<string, string | undefined> {
    const flags: Record<string, string | undefined> = {};
    for (let i = 1; i < args.length; i++) {
        const match = /^--([a-z-]+)(?:=(.*))?$/.exec(args[i]);
        if (!match || !allowed.includes(match[1])) {
            throw new ConfigError(`Unknown option: ${args[i]}. Supported: ${allowed.map(name => `--${name}`).join(', ')}`);
        }
        const value = match[2] ?? args[++i];
        if (value === undefined || value.startsWith('--')) {
            throw new ConfigError(`Option --${match[1]} needs a value.`);
        }
        flags[match[1]] = value;
    }
    return flags;
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
    update          Refresh scaffolded files (server/build)
    serve           Start the server
    build           Build static site
    help            Show this help message

Options:
    --config <file>     Configuration file (serve, build). Default: ./kb.config.json
    --plugins <file>    Plugin settings file (serve, build). Overrides KB_PLUGINS_CONFIG
    --port <number>     Port (serve). Overrides PORT and server.port
    --host <address>    Bind address (serve). Overrides HOST and server.host

Examples:
    kb init my-docs
    kb serve
    kb build
`);
}

if (require.main === module) {
    main().catch(error => {
        console.error(error);
        process.exitCode = 1;
    });
}

async function copyFrameworkAssets(projectDir: string, destination: string): Promise<void> {
    const frameworkAssetsDir = path.join(__dirname, '..', '..', 'templates', 'default', 'assets');
    const targetDir = path.join(projectDir, destination);
    await fs.mkdir(targetDir, { recursive: true });
    const entries = await fs.readdir(frameworkAssetsDir);
    for (const entry of entries) {
        await fs.copyFile(path.join(frameworkAssetsDir, entry), path.join(targetDir, entry));
    }
}
