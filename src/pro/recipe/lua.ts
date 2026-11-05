/**
 * The `lua` cleanup step: a short Lua script run on a value, as Atlas templates write them (`luaj:` in
 * `specialFormatting`). The value is the global `str`; what the script returns is the new value, nil an
 * empty one. Runs in fengari, a Lua VM in plain JS (no `eval`), with only the base, string, table and
 * math libraries, nothing that reads files or loads code, and a step budget, so a script can't loop
 * forever. A blank value is left as it is, as Atlas does.
 */
import { lauxlib, lua, lualib, to_luastring } from 'fengari';

/** Lua VM instructions a script may run on one value. */
const MAX_STEPS = 200_000;
/** Longer values are cut before the script sees them. */
const MAX_INPUT = 20_000;
const LIBS: [string, typeof lualib.luaopen_base][] = [
    ['_G', lualib.luaopen_base], ['string', lualib.luaopen_string], ['table', lualib.luaopen_table], ['math', lualib.luaopen_math],
];
/** Base functions that read files or load code, and `string.rep`, which can build a huge string in one step. */
const REMOVED = ['dofile', 'loadfile', 'load', 'require', 'print', 'collectgarbage'];

/** LuaJ reads an unknown escape (`"\$"`) as the character itself; Lua 5.3 refuses the script. */
const lenient = (code: string) => code.replace(/\\([\s\S])/g, (m, c: string) => /[abfnrtvzxu0-9\\"'\n\r]/.test(c) ? m : c);

export function runLua(code: string, input: string): string {
    if (input.trim() === '') return input;
    const L = lauxlib.luaL_newstate();
    try {
        for (const [name, open] of LIBS) {
            lauxlib.luaL_requiref(L, to_luastring(name), open, 1);
            lua.lua_pop(L, 1);
        }
        for (const name of REMOVED) {
            lua.lua_pushnil(L);
            lua.lua_setglobal(L, to_luastring(name));
        }
        lua.lua_getglobal(L, to_luastring('string'));
        lua.lua_pushnil(L);
        lua.lua_setfield(L, -2, to_luastring('rep'));
        lua.lua_pop(L, 1);

        lua.lua_pushstring(L, to_luastring(input.slice(0, MAX_INPUT)));
        lua.lua_setglobal(L, to_luastring('str'));
        lua.lua_sethook(L, S => lauxlib.luaL_error(S, to_luastring('too many steps')), lua.LUA_MASKCOUNT, MAX_STEPS);
        const chunk = to_luastring(lenient(code));
        // Text only: precompiled chunks are refused.
        if (lauxlib.luaL_loadbufferx(L, chunk, chunk.length, to_luastring('=lua'), to_luastring('t')) !== lua.LUA_OK) return '';
        if (lua.lua_pcall(L, 0, 1, 0) !== lua.LUA_OK || lua.lua_isnil(L, -1)) return '';
        lauxlib.luaL_tolstring(L, -1);
        return lua.lua_tojsstring(L, -1).trim();
    } catch {
        return '';
    } finally {
        lua.lua_close(L);
    }
}
