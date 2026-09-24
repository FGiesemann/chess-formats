import * as vscode from 'vscode';
import { LanguageValidator } from '../common/types';

class EpdValidator implements LanguageValidator {
    languageId = 'epd';
    extensions = ['.epd'];

    validate(doc: vscode.TextDocument): vscode.Diagnostic[] {
        const diagnostics: vscode.Diagnostic[] = [];
        const lines = doc.getText().split(/\r?\n/);

        lines.forEach((line, lineIndex) => {
            const trimmed = line.trim();
            if (!trimmed || trimmed.startsWith('#')) { return; }

            this.checkPiecePlacement(line, lineIndex, diagnostics);
            this.checkSideToMove(line, lineIndex, diagnostics);
            this.checkCastling(line, lineIndex, diagnostics);
            this.checkEnPassant(line, lineIndex, diagnostics);
            this.checkStringTermination(line, lineIndex, diagnostics);
            this.checkSemicolons(line, lineIndex, diagnostics);
        });

        return diagnostics;
    }

    private getHeaderFields(line: string): { fields: string[]; ends: number[] } {
        const fields: string[] = [];
        const ends: number[] = [];
        let i = 0;
        while (i < line.length && fields.length < 4) {
            while (i < line.length && /\s/.test(line[i])) { i++; }
            if (i >= line.length) { break; }
            const start = i;
            while (i < line.length && !/\s/.test(line[i])) { i++; }
            fields.push(line.slice(start, i));
            ends.push(i);
        }
        return { fields, ends };
    }

    private checkPiecePlacement(
        line: string,
        lineIndex: number,
        out: vscode.Diagnostic[]
    ) {
        const { fields, ends } = this.getHeaderFields(line);
        if (fields.length < 1) { return; }

        const placement = fields[0];
        const end = ends[0];
        const ranks = placement.split('/');

        if (ranks.length !== 8) {
            out.push(
                new vscode.Diagnostic(
                    new vscode.Range(lineIndex, 0, lineIndex, end),
                    `Piece placement must contain 8 ranks separated by '/', found ${ranks.length}`,
                    vscode.DiagnosticSeverity.Error
                )
            );
            return;
        }

        ranks.forEach((rank, rankIndex) => {
            let squares = 0;
            let valid = true;
            for (const ch of rank) {
                if (ch >= '1' && ch <= '8') {
                    squares += ch.charCodeAt(0) - 48;
                } else if (/[pnbrqkPNBRQK]/.test(ch)) {
                    squares += 1;
                } else {
                    valid = false;
                }
            }
            if (!valid) {
                out.push(
                    new vscode.Diagnostic(
                        new vscode.Range(lineIndex, 0, lineIndex, end),
                        `Rank ${8 - rankIndex} contains invalid characters`,
                        vscode.DiagnosticSeverity.Error
                    )
                );
            } else if (squares !== 8) {
                out.push(
                    new vscode.Diagnostic(
                        new vscode.Range(lineIndex, 0, lineIndex, end),
                        `Rank ${8 - rankIndex} covers ${squares} squares, expected 8`,
                        vscode.DiagnosticSeverity.Error
                    )
                );
            }
        });
    }

    private checkSideToMove(
        line: string,
        lineIndex: number,
        out: vscode.Diagnostic[]
    ) {
        const { fields, ends } = this.getHeaderFields(line);
        if (fields.length < 2) { return; }

        const side = fields[1];
        if (side !== 'w' && side !== 'b') {
            const start = ends[0] + (fields[0].length - fields[0].trimEnd().length);
            const realStart = line.indexOf(side, ends[0]);
            out.push(
                new vscode.Diagnostic(
                    new vscode.Range(lineIndex, realStart, lineIndex, realStart + side.length),
                    `Side to move must be 'w' or 'b', found '${side}'`,
                    vscode.DiagnosticSeverity.Error
                )
            );
        }
    }

    private checkCastling(
        line: string,
        lineIndex: number,
        out: vscode.Diagnostic[]
    ) {
        const { fields } = this.getHeaderFields(line);
        if (fields.length < 3) { return; }

        const castling = fields[2];
        if (castling === '-') { return; }

        if (!/^K?Q?k?q?$/.test(castling) || castling.length === 0) {
            const start = line.indexOf(castling, line.indexOf(fields[1]) + fields[1].length);
            out.push(
                new vscode.Diagnostic(
                    new vscode.Range(lineIndex, start, lineIndex, start + castling.length),
                    `Castling rights must be '-' or a combination of K, Q, k, q without repetition`,
                    vscode.DiagnosticSeverity.Error
                )
            );
        }
    }

    private checkEnPassant(
        line: string,
        lineIndex: number,
        out: vscode.Diagnostic[]
    ) {
        const { fields } = this.getHeaderFields(line);
        if (fields.length < 4) { return; }

        const ep = fields[3];
        if (ep === '-') { return; }

        if (!/^[a-h][36]$/.test(ep)) {
            const castlingEnd = line.indexOf(fields[2], line.indexOf(fields[1])) + fields[2].length;
            const start = line.indexOf(ep, castlingEnd);
            out.push(
                new vscode.Diagnostic(
                    new vscode.Range(lineIndex, start, lineIndex, start + ep.length),
                    `En passant target must be '-' or a square on rank 3 or 6, found '${ep}'`,
                    vscode.DiagnosticSeverity.Error
                )
            );
        }
    }

    private checkStringTermination(
        line: string,
        lineIndex: number,
        out: vscode.Diagnostic[]
    ) {
        const { ends } = this.getHeaderFields(line);
        if (ends.length < 4) { return; }

        const opStart = ends[3];
        const operationsPart = line.slice(opStart);
        if (operationsPart.trim().length === 0) { return; }

        const unbalanced = this.findUnbalancedQuote(operationsPart);
        if (unbalanced >= 0) {
            const pos = opStart + unbalanced;
            out.push(
                new vscode.Diagnostic(
                    new vscode.Range(lineIndex, pos, lineIndex, line.length),
                    `Unterminated string literal`,
                    vscode.DiagnosticSeverity.Warning
                )
            );
        }
    }

    private checkSemicolons(
        line: string,
        lineIndex: number,
        out: vscode.Diagnostic[]
    ) {
        const { ends } = this.getHeaderFields(line);
        if (ends.length < 4) { return; }

        const opStart = ends[3];
        const operationsPart = line.slice(opStart);

        if (operationsPart.trim().length === 0) { return; }

        const segments = operationsPart.split(';');
        const lastSegment = segments.pop() ?? '';

        let cursor = opStart;
        for (const seg of segments) {
            const leading = seg.length - seg.trimStart().length;
            const segStart = cursor + leading;
            const trimmed = seg.trim();

            if (trimmed.length > 0 && !this.looksLikeOpcodeStart(trimmed)) {
                out.push(
                    new vscode.Diagnostic(
                        new vscode.Range(lineIndex, segStart, lineIndex, segStart + 1),
                        `Missing semicolon before this section (expected an opcode)`,
                        vscode.DiagnosticSeverity.Error
                    )
                );
            }

            cursor += seg.length + 1;
        }

        if (lastSegment.trim().length > 0) {
            const lastStart = cursor + (lastSegment.length - lastSegment.trimStart().length);
            out.push(
                new vscode.Diagnostic(
                    new vscode.Range(lineIndex, lastStart, lineIndex, line.length),
                    `Missing semicolon at end of line`,
                    vscode.DiagnosticSeverity.Error
                )
            );
        }
    }

    private findUnbalancedQuote(text: string): number {
        let openIndex = -1;
        for (let i = 0; i < text.length; i++) {
            const ch = text[i];
            if (ch === '\\' && openIndex >= 0 && i + 1 < text.length) {
                i++;
                continue;
            }
            if (ch === '"') {
                if (openIndex < 0) {
                    openIndex = i;
                } else {
                    openIndex = -1;
                }
            }
        }
        return openIndex;
    }

    private looksLikeOpcodeStart(text: string): boolean {
        const match = text.match(/^[A-Za-z_][A-Za-z0-9_]*/);
        if (!match) { return false; }
        return match[0].length <= 14;
    }
}

export const epdValidator: LanguageValidator = new EpdValidator();
