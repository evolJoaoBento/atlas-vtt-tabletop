// Installs Atlas's DOM host for the copies (Atlas's plugin does it in plugin/host/initializeHost.ts before its other
// modules load): imported first by every module that mounts Atlas's components on the board.
import { installDomHost } from './app/host/dom';
import { pluginDomHost } from './app/plugin/host/dom';

installDomHost(pluginDomHost);
