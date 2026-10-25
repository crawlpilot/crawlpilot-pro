import { ok, on } from '../shared/messages';
import { registerListRunHandlers } from './handlers/listRun';
import { registerPickerHandlers } from './handlers/picker';
import { registerImageHandlers } from './handlers/images';
import { registerPageDataHandlers } from './handlers/pageData';
import { registerToolkitHandlers } from './handlers/toolkit';

// The script can be injected twice (manifest + programmatic fallback): register once per page.
const w = window as any;
if (!w.__CRAWLPILOT_CONTENT__) {
    w.__CRAWLPILOT_CONTENT__ = true;
    on('PING', () => ok({ status: 'alive' }));
    registerPickerHandlers();
    registerListRunHandlers();
    registerImageHandlers();
    registerPageDataHandlers();
    registerToolkitHandlers();
}
