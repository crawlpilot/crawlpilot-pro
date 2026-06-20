declare module 'turndown-plugin-gfm' {
    import TurndownService from 'turndown';
    export function gfm(service: TurndownService): void;
    export function tables(service: TurndownService): void;
    export function strikethrough(service: TurndownService): void;
    export function taskListItems(service: TurndownService): void;
}

declare module 'optimal-select' {
    export interface Options {
        root?: Node;
        skip?: (node: Node) => boolean;
        priority?: string[];
        ignore?: {
            class?: (className: string) => boolean;
            attribute?: (name: string, value: string, defaultPredicate: (name: string, value: string) => boolean) => boolean;
        };
    }
    export function select(element: Element, options?: Options): string;
}
