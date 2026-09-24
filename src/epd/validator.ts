import * as vscode from 'vscode';
import { LanguageValidator } from '../common/types';

interface OperandSpec {
    type: 'string' | 'move' | 'moves' | 'integer' | 'positiveInteger'
    | 'identifier' | 'any' | 'none';
    count: 'one' | 'optional' | 'zeroOrMore' | 'even' | 'none';
}

const OPCODE_SPECS: Record<string, OperandSpec> = {
    bm: { type: 'moves', count: 'zeroOrMore' },
    em: { type: 'moves', count: 'zeroOrMore' },
    id: { type: 'string', count: 'one' },
    hmvc: { type: 'integer', count: 'one' },
    fmvn: { type: 'positiveInteger', count: 'one' },
    pm: { type: 'move', count: 'one' },
    sm: { type: 'move', count: 'one' },
    pv: { type: 'moves', count: 'zeroOrMore' },
    rc: { type: 'positiveInteger', count: 'one' },
    nic: { type: 'string', count: 'optional' },
    resign: { type: 'none', count: 'none' },
    noop: { type: 'any', count: 'zeroOrMore' },
    refcom: { type: 'identifier', count: 'one' },
    refereq: { type: 'identifier', count: 'one' },
    ts: { type: 'any', count: 'even' },
    ptp: { type: 'any', count: 'even' },
    acd: { type: 'integer', count: 'one' },
    ce: { type: 'integer', count: 'one' },
    dm: { type: 'integer', count: 'one' },
    sv: { type: 'any', count: 'any' as never },
    tc: { type: 'any', count: 'any' as never },
};

const MOVE_REGEX = /^(?:O-O-O|O-O|0-0-0|0-0|[KQRBN]?[a-h]?[1-8]?x?[a-h][1-8](?:=[QRBN])?[+#]?)$/;
const IDENTIFIER_REGEX = /^[A-Za-z_][A-Za-z0-9_]*$/;

interface HeaderInfo {
    fields: string[];
    ends: number[];
}

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
            this.checkOperandTypes(line, lineIndex, diagnostics);
        });

        return diagnostics;
    }

    private getHeaderFields(line: string): HeaderInfo {
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
        if (this.findUnbalancedQuote(operationsPart) >= 0) { return; }

        const segments = this.splitAtSemicolons(operationsPart);
        const last = segments.pop()!;

        for (const seg of segments) {
            const trimmed = seg.content.trim();
            if (trimmed.length === 0) { continue; }

            if (!this.looksLikeOpcodeStart(trimmed)) {
                const leading = seg.content.length - seg.content.trimStart().length;
                const segStart = opStart + seg.start + leading;
                out.push(
                    new vscode.Diagnostic(
                        new vscode.Range(lineIndex, segStart, lineIndex, segStart + 1),
                        `Missing semicolon before this section (expected an opcode)`,
                        vscode.DiagnosticSeverity.Error
                    )
                );
            }
        }

        if (last.content.trim().length > 0) {
            const leading = last.content.length - last.content.trimStart().length;
            const lastStart = opStart + last.start + leading;
            out.push(
                new vscode.Diagnostic(
                    new vscode.Range(lineIndex, lastStart, lineIndex, line.length),
                    `Missing semicolon at end of line`,
                    vscode.DiagnosticSeverity.Error
                )
            );
        }
    }

    private checkOperandTypes(
        line: string,
        lineIndex: number,
        out: vscode.Diagnostic[]
    ) {
        const { ends } = this.getHeaderFields(line);
        if (ends.length < 4) { return; }

        const opStart = ends[3];
        const operationsPart = line.slice(opStart);
        if (operationsPart.trim().length === 0) { return; }
        if (this.findUnbalancedQuote(operationsPart) >= 0) { return; }

        const segments = this.splitAtSemicolons(operationsPart);
        segments.pop();

        for (const seg of segments) {
            const trimmed = seg.content.trim();
            if (trimmed.length === 0) { continue; }
            if (!this.looksLikeOpcodeStart(trimmed)) { continue; }

            const match = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)([\s\S]*)$/);
            if (!match) { continue; }
            const opcode = match[1];
            const operandText = match[2];

            const spec = OPCODE_SPECS[opcode];
            if (!spec) { continue; }

            const leading = seg.content.length - seg.content.trimStart().length;
            const operandOffset = opStart + seg.start + leading + opcode.length;

            this.validateOperand(opcode, spec, operandText, lineIndex, operandOffset, out);
        }
    }

    private validateOperand(
        opcode: string,
        spec: OperandSpec,
        operandText: string,
        lineIndex: number,
        operandOffset: number,
        out: vscode.Diagnostic[]
    ) {
        const trimmed = operandText.trim();

        if (spec.type === 'none') {
            if (trimmed.length > 0) {
                out.push(
                    new vscode.Diagnostic(
                        new vscode.Range(lineIndex, operandOffset, lineIndex, operandOffset + operandText.length),
                        `Opcode '${opcode}' takes no operands`,
                        vscode.DiagnosticSeverity.Error
                    )
                );
            }
            return;
        }

        if (trimmed.length === 0) {
            if (spec.count === 'one') {
                out.push(
                    new vscode.Diagnostic(
                        new vscode.Range(lineIndex, operandOffset, lineIndex, operandOffset + operandText.length),
                        `Opcode '${opcode}' requires an operand`,
                        vscode.DiagnosticSeverity.Error
                    )
                );
            }
            return;
        }

        if (spec.type === 'string') {
            if (!/^"(?:[^"\\]|\\.)*"$/.test(trimmed)) {
                out.push(
                    new vscode.Diagnostic(
                        new vscode.Range(lineIndex, operandOffset, lineIndex, operandOffset + operandText.length),
                        `Opcode '${opcode}' expects a string operand in double quotes`,
                        vscode.DiagnosticSeverity.Error
                    )
                );
            }
            return;
        }

        if (spec.type === 'integer') {
            if (!/^\d+$/.test(trimmed)) {
                out.push(
                    new vscode.Diagnostic(
                        new vscode.Range(lineIndex, operandOffset, lineIndex, operandOffset + operandText.length),
                        `Opcode '${opcode}' expects a non-negative integer`,
                        vscode.DiagnosticSeverity.Error
                    )
                );
            }
            return;
        }

        if (spec.type === 'positiveInteger') {
            if (!/^\d+$/.test(trimmed) || parseInt(trimmed, 10) === 0) {
                out.push(
                    new vscode.Diagnostic(
                        new vscode.Range(lineIndex, operandOffset, lineIndex, operandOffset + operandText.length),
                        `Opcode '${opcode}' expects a positive integer`,
                        vscode.DiagnosticSeverity.Error
                    )
                );
            }
            return;
        }

        if (spec.type === 'identifier') {
            if (!IDENTIFIER_REGEX.test(trimmed)) {
                out.push(
                    new vscode.Diagnostic(
                        new vscode.Range(lineIndex, operandOffset, lineIndex, operandOffset + operandText.length),
                        `Opcode '${opcode}' expects an identifier (no quotes)`,
                        vscode.DiagnosticSeverity.Error
                    )
                );
            }
            return;
        }

        if (spec.type === 'move') {
            if (!MOVE_REGEX.test(trimmed)) {
                out.push(
                    new vscode.Diagnostic(
                        new vscode.Range(lineIndex, operandOffset, lineIndex, operandOffset + operandText.length),
                        `Opcode '${opcode}' expects a single move, found '${trimmed}'`,
                        vscode.DiagnosticSeverity.Error
                    )
                );
            }
            return;
        }

        if (spec.type === 'moves') {
            const moves = trimmed.split(/\s+/);
            for (const move of moves) {
                if (!MOVE_REGEX.test(move)) {
                    out.push(
                        new vscode.Diagnostic(
                            new vscode.Range(lineIndex, operandOffset, lineIndex, operandOffset + operandText.length),
                            `Opcode '${opcode}' contains an invalid move: '${move}'`,
                            vscode.DiagnosticSeverity.Error
                        )
                    );
                    return;
                }
            }
            return;
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

    private splitAtSemicolons(text: string): { content: string; start: number }[] {
        const result: { content: string; start: number }[] = [];
        let current = '';
        let currentStart = 0;
        let inString = false;

        for (let i = 0; i < text.length; i++) {
            const ch = text[i];
            if (ch === '\\' && inString && i + 1 < text.length) {
                current += ch + text[i + 1];
                i++;
                continue;
            }
            if (ch === '"') {
                inString = !inString;
                current += ch;
                continue;
            }
            if (ch === ';' && !inString) {
                result.push({ content: current, start: currentStart });
                current = '';
                currentStart = i + 1;
                continue;
            }
            current += ch;
        }
        result.push({ content: current, start: currentStart });
        return result;
    }

    private looksLikeOpcodeStart(text: string): boolean {
        const match = text.match(/^[A-Za-z_][A-Za-z0-9_]*/);
        if (!match) { return false; }
        return match[0].length <= 14;
    }
}

export const epdValidator: LanguageValidator = new EpdValidator();
