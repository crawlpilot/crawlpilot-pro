export type ColumnType = 'text' | 'image' | 'url' | 'price' | 'email' | 'number' | 'date' | 'phone' | 'image_array' | 'text_array' | 'link_array';

export interface Column {
    id: string;
    originalId: string;
    name: string;
    type: ColumnType;
    order?: number;
    selector?: string;
    isVirtual?: boolean;
    mergedKeys?: string[];
    /** Raw keys that alias this column across row variants; coalesced at normalize time */
    sourceKeys?: string[];
    validation?: {
        required?: boolean;
        pattern?: string;
    };
    imageMetadata?: {
        maxWidth?: number;
        maxHeight?: number;
        maxArea?: number;
    };
}
