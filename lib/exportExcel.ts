import * as XLSX from 'xlsx';

export interface ExportColumn {
  header: string;
  key: string;
  width?: number;
}

export interface ExportSheet {
  name: string;
  columns: ExportColumn[];
  data: Record<string, unknown>[];
}

export function exportToExcel(filename: string, sheets: ExportSheet[]) {
  const wb = XLSX.utils.book_new();

  for (const sheet of sheets) {
    const headers = sheet.columns.map((c) => c.header);
    const rows = sheet.data.map((row) =>
      sheet.columns.map((c) => row[c.key] ?? '')
    );
    const wsData = [headers, ...rows];
    const ws = XLSX.utils.aoa_to_sheet(wsData);

    ws['!cols'] = sheet.columns.map((c) => ({
      wch: c.width ?? Math.max(c.header.length, 16),
    }));

    XLSX.utils.book_append_sheet(wb, ws, sheet.name);
  }

  XLSX.writeFile(wb, `${filename}.xlsx`);
}
