import * as vscode from 'vscode';
import { LanguageValidator } from '../common/types';

interface OperandSpec {
    type: 'string' | 'move' | 'integer' | 'positiveInteger'
    | 'identifier' | 'any' | 'none';
    count: 'one' | 'two' | 'optional' | 'zeroOrMore' | 'even' | 'none' | 'any';
}

const OPCODE_SPECS: Record<string, OperandSpec> = {
    acn: { type: 'positiveInteger', count: 'one' },
    acs: { type: 'positiveInteger', count: 'one' },
    am: { type: 'move', count: 'zeroOrMore' },
    bm: { type: 'move', count: 'zeroOrMore' },
    ce: { type: 'integer', count: 'one' },
    dm: { type: 'positiveInteger', count: 'one' },
    draw_accept: { type: 'none', count: 'none' },
    draw_claim: { type: 'none', count: 'none' },
    draw_offer: { type: 'none', count: 'none' },
    draw_reject: { type: 'none', count: 'none' },
    eco: { type: 'string', count: 'optional' },
    fmvn: { type: 'positiveInteger', count: 'one' },
    hmvc: { type: 'positiveInteger', count: 'one' },
    id: { type: 'string', count: 'one' },
    nic: { type: 'string', count: 'optional' },
    noop: { type: 'any', count: 'zeroOrMore' },
    pm: { type: 'move', count: 'one' },
    pv: { type: 'move', count: 'zeroOrMore' },
    rc: { type: 'positiveInteger', count: 'one' },
    resign: { type: 'none', count: 'none' },
    sm: { type: 'move', count: 'one' },
    tcgs: { type: 'positiveInteger', count: 'one' },
    tcri: { type: 'string', count: 'two' },
    tcsi: { type: 'string', count: 'two' },
};

const MOVE_REGEX = /^(?:O-O-O|O-O|0-0-0|0-0|[KQRBN]?[a-h]?[1-8]?x?[a-h][1-8](?:=[QRBN])?[+#]?)$/;
const IDENTIFIER_REGEX = /^[A-Za-z_][A-Za-z0-9_]*$/;

interface LineInfo {
    line: string;
    lineIndex: number;
    fields: string[];
    ends: number[];
    opStart: number;
    operationsPart: string;
    segments: { content: string; start: number }[];
    hasUnbalancedQuote: boolean;
    unbalancedQuoteIndex: number;
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

            const info = this.analyzeLine(line, lineIndex);

            this.checkPiecePlacement(info, diagnostics);
            this.checkSideToMove(info, diagnostics);
            this.checkCastling(info, diagnostics);
            this.checkEnPassant(info, diagnostics);
            this.checkStringTermination(info, diagnostics);
            this.checkSemicolons(info, diagnostics);
            this.checkOperandTypes(info, diagnostics);
        });

        return diagnostics;
    }

    private analyzeLine(line: string, lineIndex: number): LineInfo {
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

        const opStart = ends.length >= 4 ? ends[3] : -1;
        const operationsPart = opStart >= 0 ? line.slice(opStart) : '';
        const unbalancedQuoteIndex = this.findUnbalancedQuote(operationsPart);
        const hasUnbalancedQuote = unbalancedQuoteIndex >= 0;
        const segments = hasUnbalancedQuote ? [] : this.splitAtSemicolons(operationsPart);

        return {
            line,
            lineIndex,
            fields,
            ends,
            opStart,
            operationsPart,
            segments,
            hasUnbalancedQuote,
            unbalancedQuoteIndex,
        };
    }

    private checkPiecePlacement(info: LineInfo, out: vscode.Diagnostic[]) {
        if (info.fields.length < 1) { return; }

        const placement = info.fields[0];
        const end = info.ends[0];
        const ranks = placement.split('/');

        if (ranks.length !== 8) {
            out.push(
                new vscode.Diagnostic(
                    new vscode.Range(info.lineIndex, 0, info.lineIndex, end),
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
                        new vscode.Range(info.lineIndex, 0, info.lineIndex, end),
                        `Rank ${8 - rankIndex} contains invalid characters`,
                        vscode.DiagnosticSeverity.Error
                    )
                );
            } else if (squares !== 8) {
                out.push(
                    new vscode.Diagnostic(
                        new vscode.Range(info.lineIndex, 0, info.lineIndex, end),
                        `Rank ${8 - rankIndex} covers ${squares} squares, expected 8`,
                        vscode.DiagnosticSeverity.Error
                    )
                );
            }
        });
    }

    private checkSideToMove(info: LineInfo, out: vscode.Diagnostic[]) {
        if (info.fields.length < 2) { return; }

        const side = info.fields[1];
        if (side !== 'w' && side !== 'b') {
            const realStart = info.line.indexOf(side, info.ends[0]);
            out.push(
                new vscode.Diagnostic(
                    new vscode.Range(info.lineIndex, realStart, info.lineIndex, realStart + side.length),
                    `Side to move must be 'w' or 'b', found '${side}'`,
                    vscode.DiagnosticSeverity.Error
                )
            );
        }
    }

    private checkCastling(info: LineInfo, out: vscode.Diagnostic[]) {
        if (info.fields.length < 3) { return; }

        const castling = info.fields[2];
        if (castling === '-') { return; }

        if (!/^K?Q?k?q?$/.test(castling) || castling.length === 0) {
            const start = info.line.indexOf(
                castling,
                info.line.indexOf(info.fields[1]) + info.fields[1].length
            );
            out.push(
                new vscode.Diagnostic(
                    new vscode.Range(info.lineIndex, start, info.lineIndex, start + castling.length),
                    `Castling rights must be '-' or a combination of K, Q, k, q without repetition`,
                    vscode.DiagnosticSeverity.Error
                )
            );
        }
    }

    private checkEnPassant(info: LineInfo, out: vscode.Diagnostic[]) {
        if (info.fields.length < 4) { return; }

        const ep = info.fields[3];
        if (ep === '-') { return; }

        if (!/^[a-h][36]$/.test(ep)) {
            const castlingEnd =
                info.line.indexOf(info.fields[2], info.line.indexOf(info.fields[1])) +
                info.fields[2].length;
            const start = info.line.indexOf(ep, castlingEnd);
            out.push(
                new vscode.Diagnostic(
                    new vscode.Range(info.lineIndex, start, info.lineIndex, start + ep.length),
                    `En passant target must be '-' or a square on rank 3 or 6, found '${ep}'`,
                    vscode.DiagnosticSeverity.Error
                )
            );
        }
    }

    private checkStringTermination(info: LineInfo, out: vscode.Diagnostic[]) {
        if (info.opStart < 0) { return; }
        if (info.operationsPart.trim().length === 0) { return; }
        if (!info.hasUnbalancedQuote) { return; }

        const pos = info.opStart + info.unbalancedQuoteIndex;
        out.push(
            new vscode.Diagnostic(
                new vscode.Range(info.lineIndex, pos, info.lineIndex, info.line.length),
                `Unterminated string literal`,
                vscode.DiagnosticSeverity.Warning
            )
        );
    }

    private checkSemicolons(info: LineInfo, out: vscode.Diagnostic[]) {
        if (info.opStart < 0) { return; }
        if (info.operationsPart.trim().length === 0) { return; }
        if (info.hasUnbalancedQuote) { return; }

        const segments = info.segments.slice();
        const last = segments.pop();
        if (!last) { return; }

        for (const seg of segments) {
            const trimmed = seg.content.trim();
            if (trimmed.length === 0) { continue; }

            if (!this.looksLikeOpcodeStart(trimmed)) {
                const leading = seg.content.length - seg.content.trimStart().length;
                const segStart = info.opStart + seg.start + leading;
                out.push(
                    new vscode.Diagnostic(
                        new vscode.Range(info.lineIndex, segStart, info.lineIndex, segStart + 1),
                        `Missing semicolon before this section (expected an opcode)`,
                        vscode.DiagnosticSeverity.Error
                    )
                );
            }
        }

        if (last.content.trim().length > 0) {
            const leading = last.content.length - last.content.trimStart().length;
            const lastStart = info.opStart + last.start + leading;
            out.push(
                new vscode.Diagnostic(
                    new vscode.Range(info.lineIndex, lastStart, info.lineIndex, info.line.length),
                    `Missing semicolon at end of line`,
                    vscode.DiagnosticSeverity.Error
                )
            );
        }
    }

    private checkOperandTypes(info: LineInfo, out: vscode.Diagnostic[]) {
        if (info.opStart < 0) { return; }
        if (info.operationsPart.trim().length === 0) { return; }
        if (info.hasUnbalancedQuote) { return; }

        const segments = info.segments.slice(0, -1);

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
            const operandOffset = info.opStart + seg.start + leading + opcode.length;

            this.validateOperand(opcode, spec, operandText, info.lineIndex, operandOffset, out);
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

        if (trimmed.length !== 2) {
            if (spec.count === 'two') {
                out.push(
                    new vscode.Diagnostic(
                        new vscode.Range(lineIndex, operandOffset, lineIndex, operandOffset + operandText.length),
                        `Opcode '${opcode}' requires two operands`,
                        vscode.DiagnosticSeverity.Error
                    )
                );
            }
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
            if (spec.count === 'one') {
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
            } else if (spec.count === 'zeroOrMore') {
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
