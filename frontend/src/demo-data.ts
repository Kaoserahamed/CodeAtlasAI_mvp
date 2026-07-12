/**
 * Demo data for static deployment
 * This is the exported graph from your food delivery application
 */

import demoData from './demo-data.json';

export const demoGraphData = demoData;

// Flag to indicate if we're in demo mode
export const isDemoMode = import.meta.env.VITE_DEMO_MODE === 'true';
