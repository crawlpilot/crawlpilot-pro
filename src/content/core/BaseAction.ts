export interface ActionProgress {
    type: 'progress' | 'data' | 'status' | 'complete' | 'error' | 'initialize' | 'navigate' | 'extract' | 'wait' | 'click';
    status?: string;
    message?: string;
    page?: number;
    items?: any[];
    cumulativeTotal?: number;
    [key: string]: any;
}

export interface ActionContext {
    signal: AbortSignal;
    logger: {
        log: (msg: string, ...args: any[]) => void;
        warn: (msg: string, ...args: any[]) => void;
        error: (msg: string, ...args: any[]) => void;
    };
    // Shared state between actions in a workflow
    state: Map<string, any>;
    onProgress?: (data: any) => void;
}

export interface IAction {
    execute(context: ActionContext): Promise<void>;
}

export abstract class BaseAction implements IAction {
    protected context: ActionContext | null = null;

    abstract execute(context: ActionContext): Promise<void>;

    protected get signal(): AbortSignal {
        if (!this.context) throw new Error("Context not initialized");
        return this.context.signal;
    }

    protected get logger() {
        if (!this.context) throw new Error("Context not initialized");
        return this.context.logger;
    }

    protected get state() {
        if (!this.context) throw new Error("Context not initialized");
        return this.context.state;
    }

    protected isAborted(): boolean {
        return this.context?.signal.aborted ?? false;
    }

    protected throwIfAborted(): void {
        if (this.isAborted()) {
            throw new Error("Action aborted");
        }
    }

    protected async wait(ms: number): Promise<void> {
        this.throwIfAborted();
        return new Promise<void>((resolve, reject) => {
            const timer = setTimeout(() => {
                resolve();
            }, ms);

            this.signal.addEventListener('abort', () => {
                clearTimeout(timer);
                reject(new Error("Action aborted during wait"));
            });
        });
    }
}
