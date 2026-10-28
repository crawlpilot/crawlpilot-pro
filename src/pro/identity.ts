/**
 * Who is using Pro: the name kept on every save, review and label move. Until sign-in with the company
 * login arrives it is a name each person sets in the Backend dialog, so the rule that someone else reviews a
 * version is kept in Pro; the backend checks it again against the signed-in user.
 */
const USER_KEY = 'pro.user';

/** The name used before anyone sets one. */
export const LOCAL_AUTHOR = 'local';

export async function currentUser(): Promise<string> {
    const { [USER_KEY]: name } = await chrome.storage.local.get(USER_KEY);
    return typeof name === 'string' && name.trim() ? name.trim() : LOCAL_AUTHOR;
}

export async function setCurrentUser(name: string): Promise<void> {
    await chrome.storage.local.set({ [USER_KEY]: name.trim() });
}
