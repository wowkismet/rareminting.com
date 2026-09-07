/**
 * CSV, written to be opened in a spreadsheet without doing harm.
 *
 * Two things matter beyond commas.
 *
 * The first is escaping: a note titled `1947 "Independence", Gandhi` breaks a
 * naive join, and a description with a newline in it silently turns one row
 * into two — which nobody notices until a total is wrong.
 *
 * The second is formula injection. Excel, LibreOffice and Sheets all treat a
 * cell beginning `=`, `+`, `-` or `@` as a formula, so a seller who names
 * their listing `=HYPERLINK("http://evil","Click")` has written code that runs
 * on the machine of whichever admin opens the export. Prefixing those cells
 * with a tab neutralises it while still displaying the original text.
 */

/** One cell, escaped and made inert. */
function cell(value: unknown): string {
  if (value === null || value === undefined) return '';

  let text = String(value);

  // Neutralise anything a spreadsheet would evaluate. The tab is stripped on
  // display, so the reader still sees what the seller actually typed.
  if (/^[=+\-@\t\r]/.test(text)) text = `\t${text}`;

  // Quote when the value contains anything that would otherwise end the field.
  if (/[",\n\r]/.test(text)) return `"${text.replaceAll('"', '""')}"`;
  return text;
}

/**
 * A CSV document from a header row and its rows.
 *
 * CRLF line endings and a UTF-8 byte-order mark, both for Excel: without the
 * BOM it opens a rupee sign as mojibake, which makes a money report unusable
 * for the one audience it has.
 */
export function toCsv(headers: readonly string[], rows: readonly unknown[][]): string {
  const lines = [headers.map(cell).join(','), ...rows.map((r) => r.map(cell).join(','))];
  return `﻿${lines.join('\r\n')}\r\n`;
}

/** A CSV response the browser will download rather than display. */
export function csvResponse(filename: string, body: string): Response {
  // Only a name we generated ever reaches this, but a header cannot be allowed
  // to carry a newline or a quote regardless.
  const safe = filename.replace(/[^a-zA-Z0-9._-]/g, '-');
  return new Response(body, {
    status: 200,
    headers: {
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': `attachment; filename="${safe}"`,
      'cache-control': 'no-store',
    },
  });
}

/** `rareminting-sellers-2026-09-07.csv` */
export function csvName(report: string): string {
  return `rareminting-${report}-${new Date().toISOString().slice(0, 10)}.csv`;
}
