/** The few parts of fengari (a Lua VM in plain JS) that `pro/recipe/lua.ts` uses. */
declare module 'fengari' {
    type LuaState = unknown;
    type LuaString = Uint8Array;
    type LuaCFunction = (L: LuaState) => number;

    export function to_luastring(s: string): LuaString;

    export const lua: {
        LUA_OK: number;
        LUA_MASKCOUNT: number;
        lua_close(L: LuaState): void;
        lua_getglobal(L: LuaState, name: LuaString): number;
        lua_isnil(L: LuaState, idx: number): boolean;
        lua_pcall(L: LuaState, nargs: number, nresults: number, msgh: number): number;
        lua_pop(L: LuaState, n: number): void;
        lua_pushnil(L: LuaState): void;
        lua_pushstring(L: LuaState, s: LuaString): void;
        lua_setfield(L: LuaState, idx: number, name: LuaString): void;
        lua_setglobal(L: LuaState, name: LuaString): void;
        lua_sethook(L: LuaState, hook: ((L: LuaState) => void) | null, mask: number, count: number): void;
        lua_tojsstring(L: LuaState, idx: number): string;
    };

    export const lauxlib: {
        luaL_newstate(): LuaState;
        luaL_requiref(L: LuaState, name: LuaString, open: LuaCFunction, glb: number): void;
        luaL_loadbufferx(L: LuaState, buff: LuaString, size: number, name: LuaString, mode: LuaString): number;
        luaL_tolstring(L: LuaState, idx: number): LuaString;
        luaL_error(L: LuaState, message: LuaString): never;
    };

    export const lualib: {
        luaopen_base: LuaCFunction;
        luaopen_string: LuaCFunction;
        luaopen_table: LuaCFunction;
        luaopen_math: LuaCFunction;
    };
}
