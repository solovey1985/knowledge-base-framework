import { execSync } from 'child_process';
import { GitCommitInfo } from '../core/models';

/**
 * Service for fetching Git repository information
 */
export class GitService {
    private repoPath: string;

    constructor(repoPath: string = '.') {
        this.repoPath = repoPath;
    }

    /**
     * Get the latest commit information
     */
    getLatestCommit(): GitCommitInfo | null {
        // First check if this is a git repository
        if (!this.isGitRepository()) {
            return null;
        }

        try {
            // Get commit hash (short)
            const shortHash = execSync('git rev-parse --short HEAD', {
                cwd: this.repoPath,
                encoding: 'utf8',
                stdio: ['ignore', 'pipe', 'ignore'] // Suppress stderr
            }).trim();

            // Get commit hash (full)
            const hash = execSync('git rev-parse HEAD', {
                cwd: this.repoPath,
                encoding: 'utf8',
                stdio: ['ignore', 'pipe', 'ignore']
            }).trim();

            // Get commit message
            const message = execSync('git log -1 --pretty=%B', {
                cwd: this.repoPath,
                encoding: 'utf8',
                stdio: ['ignore', 'pipe', 'ignore']
            }).trim();

            // Get short commit message (first line)
            const shortMessage = message.split('\n')[0];

            // Get commit date (relative time)
            const dateRelative = execSync('git log -1 --pretty=%ar', {
                cwd: this.repoPath,
                encoding: 'utf8',
                stdio: ['ignore', 'pipe', 'ignore']
            }).trim();

            // Get commit date (ISO format)
            const dateISO = execSync('git log -1 --pretty=%aI', {
                cwd: this.repoPath,
                encoding: 'utf8',
                stdio: ['ignore', 'pipe', 'ignore']
            }).trim();

            // Get author name
            const author = execSync('git log -1 --pretty=%an', {
                cwd: this.repoPath,
                encoding: 'utf8',
                stdio: ['ignore', 'pipe', 'ignore']
            }).trim();

            // Get author email
            const authorEmail = execSync('git log -1 --pretty=%ae', {
                cwd: this.repoPath,
                encoding: 'utf8',
                stdio: ['ignore', 'pipe', 'ignore']
            }).trim();

            return {
                hash,
                shortHash,
                message,
                shortMessage,
                author,
                authorEmail,
                date: new Date(dateISO),
                dateRelative
            };

        } catch (error) {
            // Silently return null if git commands fail
            return null;
        }
    }

    /**
     * Get current branch name
     */
    getCurrentBranch(): string | null {
        if (!this.isGitRepository()) {
            return null;
        }

        try {
            return execSync('git rev-parse --abbrev-ref HEAD', {
                cwd: this.repoPath,
                encoding: 'utf8',
                stdio: ['ignore', 'pipe', 'ignore']
            }).trim();
        } catch (error) {
            return null;
        }
    }

    /**
     * Check if repository has uncommitted changes
     */
    hasUncommittedChanges(): boolean {
        if (!this.isGitRepository()) {
            return false;
        }
        try {
            const status = execSync('git status --porcelain', {
                cwd: this.repoPath,
                encoding: 'utf8',
                stdio: ['ignore', 'pipe', 'ignore']
            }).trim();

            return status.length > 0;
        } catch (error) {
            return false;
        }
    }

    /**
     * Get repository remote URL
     */
    getRemoteUrl(): string | null {
        if (!this.isGitRepository()) {
            return null;
        }

        try {
            return execSync('git config --get remote.origin.url', {
                cwd: this.repoPath,
                encoding: 'utf8',
                stdio: ['ignore', 'pipe', 'ignore']
            }).trim();
        } catch (error) {
            return null;
        }
    }

    /**
     * Check if current directory is a Git repository
     */
    isGitRepository(): boolean {
        try {
            execSync('git rev-parse --git-dir', {
                cwd: this.repoPath,
                encoding: 'utf8',
                stdio: ['ignore', 'ignore', 'ignore'] // Suppress all output
            });
            return true;
        } catch (error) {
            return false;
        }
    }

    /**
     * Get commit info formatted for display
     */
    getCommitInfoForDisplay(): GitCommitInfo | null {
        if (!this.isGitRepository()) {
            return null;
        }

        return this.getLatestCommit();
    }
}