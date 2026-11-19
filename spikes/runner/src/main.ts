/**
 * Main-thread entry of Holotype Spikes. The only module that touches the `figma` global;
 * every spike task receives the API through its context.
 */
import { createMainHost } from './host.ts';
import { allTasks } from './tasks.ts';

figma.showUI(__html__, { width: 380, height: 620, themeColors: true, title: 'Holotype Spikes' });
createMainHost(figma, allTasks);
