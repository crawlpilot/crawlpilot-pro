/** What the open page is, in a glance: what Home suggests doing with it. */
export interface PageSummary {
    /**
     * `list`: repeating items (search results, a product grid, a table);
     * `product`: one product's page; `article`: a story or post; `none`: nothing recognised.
     */
    kind: 'list' | 'product' | 'article' | 'none';
    /** The list's item count, for `list`. */
    items?: number;
    /** What the items are, when the page says so: "products", "jobs", "articles"; else "items". */
    noun: string;
    /** The product's or article's name, when the page publishes it. */
    name?: string;
}
