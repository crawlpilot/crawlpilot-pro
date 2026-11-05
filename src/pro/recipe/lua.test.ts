import { describe, expect, it } from 'vitest';
import { runLua } from './lua';
import { applyProOps } from './ops';

describe('runLua', () => {
    it('runs the Atlas price, ISBN and flag scripts', () => {
        expect(runLua('ret1 = string.gsub(str, "\\$%s+", "\\$"); return string.gsub(ret1, "%s+", ".")', '$ 12 99')).toBe('$12.99');
        expect(runLua('if string.find(str, "%.") then str1 = str else str1 = string.gsub(str, \'()\', {[string.len(str)-1]=\'.\'}) end;str2 = string.gsub(str1, "[^0-9.$]",""); if string.find(str, "%d") then return str2 else return nil end;', '$1299')).toBe('$12.99');
        expect(runLua('if string.match(str,"ISBN[-]?[1][3]%s[0-9]+") then str = string.match(str,"ISBN[-]?[1][3]%s[0-9]+");num = string.sub(str,9); return num else return nil end;', 'Pages 320 ISBN-13 9780306406157 Weight')).toBe('9780306406157');
        expect(runLua('if str then return "Y" else return "N" end', 'Size')).toBe('Y');
        expect(runLua('return string.gsub(str,"%D", "");', 'Deliver to 55401')).toBe('55401');
        expect(runLua('str1 = string.match(str, "^[^?#]+"); return string.match(str1, "/ip/.*/([%w]+)/*$") or string.match(str1, "/ip/([%w]+)/*$");', 'https://www.walmart.com/ip/Some-Thing/123456?x=1')).toBe('123456');
    });

    it('gives nothing for nil, an undefined global (`null`), an error or a script that does not parse', () => {
        expect(runLua('if string.find(str, "/") then return str else return null end;', 'no slash')).toBe('');
        expect(runLua('return nil', 'x')).toBe('');
        expect(runLua('error("boom")', 'x')).toBe('');
        expect(runLua('return (', 'x')).toBe('');
    });

    it('leaves a blank value as it is, as Atlas does', () => {
        expect(runLua('return "Y"', '  ')).toBe('  ');
    });

    it('stops a script that runs too long, and has nothing that loads code or files', () => {
        expect(runLua('while true do end', 'x')).toBe('');
        expect(runLua('return tostring(load) .. tostring(dofile) .. tostring(require) .. tostring(io) .. tostring(os) .. tostring(string.rep)', 'x'))
            .toBe('nilnilnilnilnilnil');
    });

    it('runs as a cleanup step, on each item of a list', () => {
        expect(applyProOps(['a1', 'b2'], [{ op: 'lua', code: 'return string.upper(str)' }, { op: 'join', sep: ' > ' }])).toBe('A1 > B2');
    });
});
