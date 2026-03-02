const NAMESPACE = 'matecito_';

export const storage = {
    get<T>(key: string): T | null {
        try {
            const item = localStorage.getItem(NAMESPACE + key);
            return item ? JSON.parse(item) : null;
        } catch (e) {
            console.warn('Error reading from localStorage', e);
            return null;
        }
    },

    set<T>(key: string, value: T): void {
        try {
            localStorage.setItem(NAMESPACE + key, JSON.stringify(value));
        } catch (e) {
            console.warn('Error saving to localStorage', e);
        }
    },

    remove(key: string): void {
        try {
            localStorage.removeItem(NAMESPACE + key);
        } catch (e) {
            console.warn('Error removing from localStorage', e);
        }
    },

    clear(): void {
        try {
            // Only clear matecito namespace
            const keys = Object.keys(localStorage);
            for (const key of keys) {
                if (key.startsWith(NAMESPACE)) {
                    localStorage.removeItem(key);
                }
            }
        } catch (e) {
            console.warn('Error clearing localStorage', e);
        }
    }
};
