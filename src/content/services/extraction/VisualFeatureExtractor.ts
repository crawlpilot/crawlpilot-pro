/**
 * VisualFeatureExtractor
 * Extracts visual styling features for layout-aware semantic detection
 * Inspired by LayoutLMv3's visual feature modeling
 */

export interface VisualFeatures {
    fontSize: number;
    fontWeight: number;
    color: string;
    backgroundColor: string;
    opacity: number;
    prominenceScore: number; // 0-1 (how visually prominent)
    isHighlighted: boolean;  // Red/green/yellow background
    textAlign: 'left' | 'center' | 'right';
    isStrikethrough: boolean; // For detecting crossed-out prices
    colorContrast: number;    // 0-1 (text vs background contrast)
}

export class VisualFeatureExtractor {
    /**
     * Extract all visual features from an element
     */
    extract(element: Element): VisualFeatures {
        const style = window.getComputedStyle(element);

        const fontSize = parseFloat(style.fontSize) || 16;
        const fontWeight = this.parseWeight(style.fontWeight);
        const color = style.color;
        const backgroundColor = style.backgroundColor;
        const opacity = parseFloat(style.opacity) || 1;
        const textDecoration = style.textDecoration;

        return {
            fontSize,
            fontWeight,
            color,
            backgroundColor,
            opacity,
            prominenceScore: this.calculateProminence(fontSize, fontWeight, color, backgroundColor),
            isHighlighted: this.isHighlightedElement(backgroundColor),
            textAlign: this.parseTextAlign(style.textAlign),
            isStrikethrough: textDecoration.includes('line-through'),
            colorContrast: this.calculateColorContrast(color, backgroundColor)
        };
    }

    /**
     * Calculate prominence score (0-1) based on visual weight
     * Higher = more visually prominent (likely important information)
     */
    private calculateProminence(
        fontSize: number,
        fontWeight: number,
        color: string,
        backgroundColor: string
    ): number {
        let score = 0;

        // Large font = more prominent (max 0.4)
        const sizeScore = Math.min(fontSize / 32, 1) * 0.4;
        score += sizeScore;

        // Bold = more prominent (max 0.3)
        const weightScore = fontWeight >= 700 ? 0.3 : (fontWeight >= 600 ? 0.15 : 0);
        score += weightScore;

        // High color contrast = more prominent (max 0.3)
        const contrast = this.calculateColorContrast(color, backgroundColor);
        score += contrast * 0.3;

        return Math.min(score, 1);
    }

    /**
     * Check if element has highlighted background (sale price, badges, etc.)
     */
    private isHighlightedElement(backgroundColor: string): boolean {
        // Parse RGB/RGBA
        const rgb = this.parseColor(backgroundColor);
        if (!rgb) return false;

        // Red-ish (sale/discount indicators)
        const isRed = rgb.r > 200 && rgb.g < 100 && rgb.b < 100;

        // Green-ish (savings/eco indicators)
        const isGreen = rgb.g > 200 && rgb.r < 150 && rgb.b < 150;

        // Yellow/Orange-ish (warnings/special offers)
        const isYellow = rgb.r > 200 && rgb.g > 150 && rgb.b < 100;

        return isRed || isGreen || isYellow;
    }

    /**
     * Calculate color contrast ratio (simplified)
     * Returns 0-1 where 1 is maximum contrast
     */
    private calculateColorContrast(foreground: string, background: string): number {
        const fg = this.parseColor(foreground);
        const bg = this.parseColor(background);

        if (!fg || !bg) return 0.5; // Default moderate contrast

        // Calculate relative luminance
        const fgLum = this.getLuminance(fg);
        const bgLum = this.getLuminance(bg);

        // Contrast ratio (simplified)
        const lighter = Math.max(fgLum, bgLum);
        const darker = Math.min(fgLum, bgLum);
        const contrast = (lighter + 0.05) / (darker + 0.05);

        // Normalize to 0-1 (WCAG AAA is 7:1, we'll use that as max)
        return Math.min(contrast / 7, 1);
    }

    /**
     * Get relative luminance of a color
     */
    private getLuminance(rgb: { r: number; g: number; b: number }): number {
        // Convert to 0-1 range
        const r = rgb.r / 255;
        const g = rgb.g / 255;
        const b = rgb.b / 255;

        // Apply gamma correction
        const rLin = r <= 0.03928 ? r / 12.92 : Math.pow((r + 0.055) / 1.055, 2.4);
        const gLin = g <= 0.03928 ? g / 12.92 : Math.pow((g + 0.055) / 1.055, 2.4);
        const bLin = b <= 0.03928 ? b / 12.92 : Math.pow((b + 0.055) / 1.055, 2.4);

        // Calculate luminance
        return 0.2126 * rLin + 0.7152 * gLin + 0.0722 * bLin;
    }

    /**
     * Parse CSS color string to RGB
     */
    private parseColor(color: string): { r: number; g: number; b: number } | null {
        // Match rgb(r, g, b) or rgba(r, g, b, a)
        const rgbMatch = color.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
        if (rgbMatch) {
            return {
                r: parseInt(rgbMatch[1]),
                g: parseInt(rgbMatch[2]),
                b: parseInt(rgbMatch[3])
            };
        }

        // TODO: Could add hex color support if needed
        return null;
    }

    /**
     * Parse font-weight to numeric value
     */
    private parseWeight(weight: string): number {
        const numWeight = parseInt(weight);
        if (!isNaN(numWeight)) return numWeight;

        // Handle named weights
        switch (weight.toLowerCase()) {
            case 'normal': return 400;
            case 'bold': return 700;
            case 'lighter': return 300;
            case 'bolder': return 800;
            default: return 400;
        }
    }

    /**
     * Parse text-align to enum
     */
    private parseTextAlign(align: string): 'left' | 'center' | 'right' {
        if (align === 'center') return 'center';
        if (align === 'right' || align === 'end') return 'right';
        return 'left';
    }
}
