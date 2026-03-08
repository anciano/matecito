export interface EnvConfig {
    slug: string;
    title: string;
    model_url: string;
    target_url?: string; // MindAR marker file
    usdz_url?: string;
    audio_preview_url: string;
    min_accuracy_m: number;
    min_move_m: number;
    spawn_distance_m: [number, number];
    ar_url?: string;
}

/**
 * Loads the environment configuration for a given slug.
 * Assumes configs are placed in /env/{slug}.json
 */
export async function loadEnv(slug: string): Promise<EnvConfig> {
    const response = await fetch(`/env/${slug}.json`);
    if (!response.ok) {
        throw new Error(`Failed to load config for slug: ${slug}`);
    }
    return response.json();
}

/**
 * Helper to extract slug from URL parameters
 */
export function getSlugFromUrl(): string | null {
    const params = new URLSearchParams(window.location.search);
    return params.get('slug');
}
