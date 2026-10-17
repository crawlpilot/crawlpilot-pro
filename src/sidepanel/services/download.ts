/** Saves text as a file; `stamp` adds the date and time before the extension (data_2026-10-17T12-00-00.csv). */
export function downloadText(content: string, fileName: string, type: string, stamp = false) {
    let name = fileName;
    if (stamp) {
        const time = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
        const dot = fileName.lastIndexOf('.');
        name = dot > 0 ? `${fileName.slice(0, dot)}_${time}${fileName.slice(dot)}` : `${fileName}_${time}`;
    }
    const url = URL.createObjectURL(new Blob([content], { type }));
    const link = document.createElement('a');
    link.href = url;
    link.download = name;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function downloadJson(data: unknown, fileName: string) {
    downloadText(JSON.stringify(data, null, 2), fileName, 'application/json');
}
