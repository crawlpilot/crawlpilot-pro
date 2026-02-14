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
