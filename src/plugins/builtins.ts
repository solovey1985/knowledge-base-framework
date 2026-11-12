import { registerPlugin } from '../core/pluginRegistry';
import { googleDriveStoragePlugin, GoogleDriveStorageOptions } from './google-drive-storage';
import { interviewPrepPlugin, InterviewPrepPluginOptions } from './interviewPrepPlugin';
import { passwordAuthPlugin, PasswordAuthOptions } from './password-auth';
import { techMemoryPlugin, TechMemoryPluginOptions } from './techMemoryPlugin';
import { threeDViewerPlugin, ThreeDViewerPluginOptions } from './threeDViewerPlugin';
import { workManagerPlugin, WorkManagerOptions } from './work-manager';

// Built-in plugins use the same registry as third-party ones.
registerPlugin<ThreeDViewerPluginOptions>({ name: 'three-d-viewer', aliases: ['three-viewer'], create: options => threeDViewerPlugin(options) });
registerPlugin<InterviewPrepPluginOptions>({ name: 'interview-prep', create: options => interviewPrepPlugin(options) });
registerPlugin<TechMemoryPluginOptions>({ name: 'tech-memory', create: options => techMemoryPlugin(options) });
registerPlugin<PasswordAuthOptions>({ name: 'password-auth', create: options => passwordAuthPlugin(options) });
registerPlugin<GoogleDriveStorageOptions>({ name: 'google-drive-storage', create: options => googleDriveStoragePlugin(options) });
registerPlugin<WorkManagerOptions>({ name: 'work-manager', create: options => workManagerPlugin(options) });
