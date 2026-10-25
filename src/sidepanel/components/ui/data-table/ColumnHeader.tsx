import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { IconButton } from '../../../ui';
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

    const stop = (e: React.MouseEvent) => e.stopPropagation();
    return (
        <div className="group flex w-full items-center justify-between" role="columnheader">
            {isEditing ? (
                <div className="flex w-full items-center gap-0.5" onClick={stop}>
                    <input type="text" value={tempName} onChange={e => setTempName(e.target.value)} autoFocus
                        aria-label={`${t('header.rename')} ${props.displayName}`}
                        onKeyDown={e => { if (e.key === 'Enter') onSave(); if (e.key === 'Escape') setIsEditing(false); }}
                        className="w-full min-w-0 rounded-md border-[1.5px] border-line-strong bg-surface px-2 py-1 text-caption text-ink outline-none" />
                    <IconButton size="sm" label={t('header.saveName')} className="text-success" onClick={onSave}><Check /></IconButton>
                    <IconButton size="sm" label={t('header.cancel')} onClick={() => setIsEditing(false)}><X /></IconButton>
                </div>
            ) : isConfirmingDelete ? (
                <div className="flex w-full items-center gap-0.5" onClick={stop}>
                    <span className="truncate text-caption font-semibold text-danger">{t('header.deletePrompt')}</span>
                    <IconButton size="sm" label={`${t('header.confirmDelete')} ${props.displayName}`} className="text-danger" onClick={onDelete}><Check /></IconButton>
                    <IconButton size="sm" label={t('header.cancel')} onClick={() => setIsConfirmingDelete(false)}><X /></IconButton>
                </div>
            ) : (
                <div className="flex w-full items-center justify-between">
                    <span className="truncate font-semibold text-ink" title={props.displayName}>{props.displayName}</span>
                    <div className="ml-1 flex items-center opacity-30 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
                        <IconButton size="sm" label={`Clean ${props.displayName}`} onClick={e => { e.stopPropagation(); props.context.onCleanColumn?.(props.column.colId); }}><Wand2 /></IconButton>
                        <IconButton size="sm" label={`${t('header.rename')} ${props.displayName}`} onClick={e => { e.stopPropagation(); setIsEditing(true); }}><Edit /></IconButton>
                        <IconButton size="sm" label={`${t('header.delete')} ${props.displayName}`} className="hover:text-danger" onClick={e => { e.stopPropagation(); setIsConfirmingDelete(true); }}><Trash2 /></IconButton>
                    </div>
                </div>
            )}
        </div>
    );
}
