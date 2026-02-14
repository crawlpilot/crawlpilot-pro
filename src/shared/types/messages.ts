// Message types for communication between extension components

export type MessageType =
    | 'AUTOMATION_START'
    | 'AUTOMATION_STOP'
    | 'AUTOMATION_STATUS'
    | 'DATA_SAVED'
    | 'EXTRACTION_COMPLETE'
    | 'PING'
    | 'AUTO_SCROLL_UPDATE'
    | 'AUTO_SCROLL_STATUS'
    | 'AUTO_SCROLL_COMPLETE'
    | 'EXECUTE_AUTO_SCROLL'
    | 'STOP_AUTO_SCROLL'
    | 'ELEMENT_SELECTED'
    | 'START_PICKER'
    | 'STOP_PICKER'
    | 'EXECUTE_PAGINATION'
    | 'STOP_PAGINATION'
    | 'PAGINATION_UPDATE'
    | 'PAGINATION_STATUS'
    | 'PAGINATION_COMPLETE'
    | 'OPEN_DATA_VIEWER'
    | 'PICKER_CANCELLED'
    | 'CMD_EXTRACT_PAGE'
    | 'CMD_PAGINATION_ACTION'
    | 'TEST_SELECTOR';

export interface BaseMessage {
    type: MessageType;
    timestamp?: number;
}

export interface AutomationStartMessage extends BaseMessage {
    type: 'AUTOMATION_START';
    payload: {
        automationId: number;
        type: string;
        config: any;
    };
}

export interface AutomationStopMessage extends BaseMessage {
    type: 'AUTOMATION_STOP';
    payload: {
        automationId: number;
    };
}

export interface AutomationStatusMessage extends BaseMessage {
    type: 'AUTOMATION_STATUS';
    payload: {
        automationId: number;
        status: string;
        progress?: {
            current: number;
            total: number;
        };
    };
}

export interface DataSavedMessage extends BaseMessage {
    type: 'DATA_SAVED';
    payload: {
        tableDataId: number;
    };
}

export interface ExtractionCompleteMessage extends BaseMessage {
    type: 'EXTRACTION_COMPLETE';
    payload: {
        data: any;
        tableDataId?: number;
    };
}



export type Message =
    | AutomationStartMessage
    | AutomationStopMessage
    | AutomationStatusMessage
    | DataSavedMessage
    | ExtractionCompleteMessage
    | BaseMessage;
