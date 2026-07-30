// The AI indicator: label, toggle and download progress bar.

import { sendToBackground } from '../shared/messages';
import type { SemanticState } from './semanticClient';

export class AiStatusUi {
    private enabled = true;

    constructor(
        private readonly elements: {
            indicator: HTMLElement;
            label: HTMLElement;
            toggle: HTMLInputElement;
            progress: HTMLElement;
            progressBar: HTMLElement;
        },
        private readonly onToggle: (enabled: boolean) => void
    ) {
        // Always visible so the toggle stays reachable; the label carries state.
        this.elements.indicator.style.display = 'flex';
        this.elements.toggle.checked = this.enabled;

        this.elements.toggle.addEventListener('change', () => {
            this.enabled = this.elements.toggle.checked;
            void sendToBackground({ action: 'ai-enabled-set', enabled: this.enabled });
            if (!this.enabled) this.elements.progress.classList.remove('visible');
            this.onToggle(this.enabled);
        });
    }

    get isEnabled(): boolean {
        return this.enabled;
    }

    /** Reads the persisted setting; the optimistic default stands if unreachable. */
    async loadSetting(): Promise<void> {
        const response = await sendToBackground({ action: 'ai-enabled-get' });
        if (!response) return;
        this.enabled = response.enabled;
        this.elements.toggle.checked = this.enabled;
    }

    render(state: SemanticState, progress: number): void {
        const { label, progress: bar, progressBar } = this.elements;

        bar.classList.toggle('visible', this.enabled && state === 'downloading');
        progressBar.style.width = `${progress}%`;

        if (!this.enabled) {
            label.textContent = '✨ AI Off';
            label.style.color = '#555';
            return;
        }

        switch (state) {
            case 'downloading':
                label.textContent = `✨ Loading model ${progress}%`;
                label.style.color = '#3b82f6';
                break;
            case 'fallback':
                label.textContent = '✨ AI Ready (basic)';
                label.style.color = '#666';
                break;
            case 'ready':
                label.textContent = '✨ AI Ready';
                label.style.color = '#666';
                break;
            default:
                label.textContent = '✨ AI starting…';
                label.style.color = '#666';
        }
    }
}
