import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { IconButton, Tooltip } from '@mui/material';
import { Check, Edit, Trash2, Wand2, X } from 'lucide-react';

/** A column header with rename, delete and clean / set type actions (ag-grid header component). */
export function ColumnHeader(props: any) {
    const { t } = useTranslation('dataTable');
    const [isEditing, setIsEditing] = useState(false);
    const [isConfirmingDelete, setIsConfirmingDelete] = useState(false);
    const [tempName, setTempName] = useState(props.displayName);

    useEffect(() => {
        setTempName(props.displayName);
    }, [props.displayName]);

    const onSave = () => {
        if (tempName.trim()) {
            props.context.onRenameColumn(props.column.colId, tempName);
            setIsEditing(false);
        }
    };

    const onDelete = () => {
        props.context.onDeleteColumn(props.column.colId);
        setIsConfirmingDelete(false);
    };

    return (
        <div className="flex items-center justify-between w-full group" role="columnheader">
            {isEditing ? (
                <div className="flex items-center gap-1 w-full" onClick={(e) => e.stopPropagation()}>
                    <input
                        type="text"
                        value={tempName}
                        onChange={(e) => setTempName(e.target.value)}
                        className="w-full text-xs px-2 py-1 border rounded bg-white text-gray-900"
                        autoFocus
                        aria-label={`${t('header.rename')} ${props.displayName}`}
                        onKeyDown={(e) => {
                            if (e.key === 'Enter') onSave();
                            if (e.key === 'Escape') setIsEditing(false);
                        }}
                    />
                    <Tooltip title={t('header.saveName')}>
                        <IconButton size="small" onClick={onSave} aria-label={t('header.saveName')} sx={{ color: 'success.main', p: 0.5 }}>
                            <Check size={14} />
                        </IconButton>
                    </Tooltip>
                    <Tooltip title={t('header.cancel')}>
                        <IconButton size="small" onClick={() => setIsEditing(false)} aria-label={t('header.cancel')} sx={{ color: 'error.main', p: 0.5 }}>
                            <X size={14} />
                        </IconButton>
                    </Tooltip>
                </div>
            ) : isConfirmingDelete ? (
                <div className="flex items-center gap-1 w-full" onClick={(e) => e.stopPropagation()}>
                    <span className="text-xs text-accent-red font-semibold truncate">{t('header.deletePrompt')}</span>
                    <Tooltip title={t('header.confirmDelete')}>
                        <IconButton size="small" onClick={onDelete} aria-label={`${t('header.confirmDelete')} ${props.displayName}`} sx={{ color: 'error.main', p: 0.5 }}>
                            <Check size={14} />
                        </IconButton>
                    </Tooltip>
                    <Tooltip title={t('header.cancel')}>
                        <IconButton size="small" onClick={() => setIsConfirmingDelete(false)} aria-label={t('header.cancel')} sx={{ color: 'text.secondary', p: 0.5 }}>
                            <X size={14} />
                        </IconButton>
                    </Tooltip>
                </div>
            ) : (
                <div className="flex items-center justify-between w-full">
                    <span className="truncate font-semibold text-gray-700 dark:text-gray-300" title={props.displayName}>{props.displayName}</span>
                    <div className="flex items-center opacity-30 group-hover:opacity-100 transition-opacity ml-1">
                        <Tooltip title="Clean / set type">
                            <IconButton
                                size="small"
                                aria-label={`Clean ${props.displayName}`}
                                onClick={(e) => { e.stopPropagation(); props.context.onCleanColumn?.(props.column.colId); }}
                                sx={{ p: 0.5, color: 'text.secondary', '&:hover': { color: 'primary.main' } }}
                            >
                                <Wand2 size={14} />
                            </IconButton>
                        </Tooltip>
                        <Tooltip title={t('header.rename')}>
                            <IconButton
                                size="small"
                                aria-label={`${t('header.rename')} ${props.displayName}`}
                                onClick={(e) => { e.stopPropagation(); setIsEditing(true); }}
                                sx={{ p: 0.5, color: 'text.secondary', '&:hover': { color: 'primary.main' } }}
                            >
                                <Edit size={14} />
                            </IconButton>
                        </Tooltip>
                        <Tooltip title={t('header.delete')}>
                            <IconButton
                                size="small"
                                aria-label={`${t('header.delete')} ${props.displayName}`}
                                onClick={(e) => { e.stopPropagation(); setIsConfirmingDelete(true); }}
                                sx={{ p: 0.5, color: 'text.secondary', '&:hover': { color: 'error.main' } }}
                            >
                                <Trash2 size={14} />
                            </IconButton>
                        </Tooltip>
                    </div>
                </div>
            )}
        </div>
    );
}
