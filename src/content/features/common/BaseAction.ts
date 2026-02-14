
export interface ActionProgress {
    type: 'progress' | 'data' | 'status' | 'complete' | 'error';
    status?: string;
    message?: string;
    page?: number;
    items?: any[];
    cumulativeTotal?: number;
    [key: string]: any;
}

export interface ICrawlAction<TConfig, TResult = any> {
    execute(config: TConfig, onProgress: (progress: ActionProgress) => void): Promise<TResult>;
    cancel(): void;
}

export abstract class BaseAction {
    protected isCancelled: boolean = false;

    public cancel(): void {
        this.isCancelled = true;
        console.log(`[${this.constructor.name}] Action cancelled`);
    }

    protected async wait(ms: number): Promise<void> {
        return new Promise(resolve => {
            if (this.isCancelled) {
                resolve();
                return;
            }

            const startTime = Date.now();
            const check = () => {
                if (this.isCancelled) {
                    resolve();
                    return;
                }
                const elapsed = Date.now() - startTime;
                if (elapsed >= ms) {
                    resolve();
                    return;
                }
                // Check again after a short interval, or the remaining time if less than 100ms
                setTimeout(check, Math.min(100, ms - elapsed));
            };

            check();
        });
    }

    protected checkCancelled(): void {
        if (this.isCancelled) {
            throw new Error('Action cancelled');
        }
    }
}
