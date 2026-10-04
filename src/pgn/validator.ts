import * as vscode from 'vscode';
import { LanguageValidator } from '../common/types';

const REQUIRED_TAGS = [
    'Event',
    'Site',
    'Date',
    'Round',
    'White',
    'Black',
    'Result',
] as const;

const VALID_RESULTS = ['1-0', '0-1', '1/2-1/2', '*'];

const TAG_REGEX = /^\[\s*([A-Za-z][A-Za-z0-9_]*)\s+"((?:[^"\\]|\\.)*)"\s*\]\s*$/;

const DATE_REGEX = /^\d{4}\.(?:\d{2}|\?\?)\.(?:\d{2}|\?\?)$/;

interface Tag {
    name: string;
    value: string;
    lineIndex: number;
    startChar: number;
    endChar: number;
    raw: string;
}

interface GameSection {
    tags: Tag[];
    tagStartLine: number;
    tagEndLine: number;
    movetextStartOffset: number;
    movetextEndOffset: number;
}

interface TextLine {
    text: string;
    startOffset: number;
}

class PgnValidator implements LanguageValidator {
    languageId = 'pgn';
    extensions = ['.pgn'];

    validate(doc: vscode.TextDocument): vscode.Diagnostic[] {
        const diagnostics: vscode.Diagnostic[] = [];
        const text = doc.getText();

        const games = this.splitGames(text);

        for (const game of games) {
            this.checkTags(game, text, diagnostics);
            this.checkMovetext(game, text, diagnostics);
        }

        return diagnostics;
    }

    private splitLinesWithOffsets(text: string): TextLine[] {
        const result: TextLine[] = [];
        let offset = 0;
        while (offset <= text.length) {
            let lineEnd = text.indexOf('\n', offset);
            let nextOffset: number;
            let lineText: string;
            if (lineEnd < 0) {
                lineText = text.slice(offset);
                nextOffset = text.length + 1;
            } else {
                lineText = text.slice(offset, lineEnd);
                if (lineText.endsWith('\r')) {
                    lineText = lineText.slice(0, -1);
                }
                nextOffset = lineEnd + 1;
            }
            result.push({ text: lineText, startOffset: offset });
            if (lineEnd < 0) { break; }
            offset = nextOffset;
        }
        return result;
    }

    private offsetToLineIndex(text: string, offset: number): number {
        let line = 0;
        for (let i = 0; i < offset && i < text.length; i++) {
            if (text[i] === '\n') { line++; }
        }
        return line;
    }

    private splitGames(text: string): GameSection[] {
        const lines = this.splitLinesWithOffsets(text);
        const games: GameSection[] = [];

        let currentTags: Tag[] = [];
        let tagStartLine = -1;
        let tagEndLine = -1;
        let movetextStartLine = -1;
        let movetextEndLine = -1;
        let inMovetext = false;

        const flushGame = () => {
            const hasTags = currentTags.length > 0;
            const hasMovetext = movetextStartLine >= 0;
            if (!hasTags && !hasMovetext) { return; }

            const movetextStartOffset =
                movetextStartLine >= 0 ? lines[movetextStartLine].startOffset : -1;
            const movetextEndOffset =
                movetextEndLine >= 0
                    ? movetextEndLine + 1 < lines.length
                        ? lines[movetextEndLine + 1].startOffset
                        : text.length
                    : -1;

            games.push({
                tags: currentTags,
                tagStartLine,
                tagEndLine,
                movetextStartOffset,
                movetextEndOffset,
            });

            currentTags = [];
            tagStartLine = -1;
            tagEndLine = -1;
            movetextStartLine = -1;
            movetextEndLine = -1;
            inMovetext = false;
        };

        for (let i = 0; i < lines.length; i++) {
            const line = lines[i].text;
            const trimmed = line.trim();

            if (trimmed === '') {
                continue;
            }

            if (trimmed.startsWith('[')) {
                if (inMovetext) {
                    flushGame();
                }
                if (tagStartLine < 0) {
                    tagStartLine = i;
                }
                tagEndLine = i;
                currentTags.push({
                    name: '',
                    value: '',
                    lineIndex: i,
                    startChar: 0,
                    endChar: line.length,
                    raw: line,
                });
                continue;
            }

            if (!inMovetext) {
                inMovetext = true;
                movetextStartLine = i;
            }
            movetextEndLine = i;
        }

        flushGame();
        return games;
    }

    private checkTags(
        game: GameSection,
        text: string,
        out: vscode.Diagnostic[]
    ) {
        const parsedTags: Tag[] = [];

        for (const raw of game.tags) {
            const line = raw.raw;
            const match = line.match(TAG_REGEX);
            if (!match) {
                out.push(
                    new vscode.Diagnostic(
                        new vscode.Range(raw.lineIndex, 0, raw.lineIndex, line.length),
                        `Invalid tag syntax. Expected [Name "Value"]`,
                        vscode.DiagnosticSeverity.Error
                    )
                );
                continue;
            }
            const name = match[1];
            const value = match[2];
            const nameStart = line.indexOf(name);
            parsedTags.push({
                name,
                value,
                lineIndex: raw.lineIndex,
                startChar: nameStart,
                endChar: nameStart + name.length,
                raw: line,
            });
        }

        for (const tag of parsedTags) {
            if (tag.name === 'Result' && !VALID_RESULTS.includes(tag.value)) {
                out.push(
                    new vscode.Diagnostic(
                        new vscode.Range(tag.lineIndex, 0, tag.lineIndex, tag.raw.length),
                        `Result tag must be one of ${VALID_RESULTS.join(', ')}, found '${tag.value}'`,
                        vscode.DiagnosticSeverity.Error
                    )
                );
            }
            if (tag.name === 'Date' && !DATE_REGEX.test(tag.value)) {
                out.push(
                    new vscode.Diagnostic(
                        new vscode.Range(tag.lineIndex, 0, tag.lineIndex, tag.raw.length),
                        `Date tag must use format YYYY.MM.DD with ?? for unknown parts`,
                        vscode.DiagnosticSeverity.Error
                    )
                );
            }
        }

        const firstSeven = parsedTags.slice(0, 7).map(t => t.name);
        const missing = REQUIRED_TAGS.filter((t, i) => firstSeven[i] !== t);

        if (missing.length > 0) {
            const insertionLine = game.tagStartLine >= 0 ? game.tagStartLine : 0;
            out.push(
                new vscode.Diagnostic(
                    new vscode.Range(insertionLine, 0, insertionLine, 0),
                    `Missing or misordered Seven Tag Roster. Expected order: ${REQUIRED_TAGS.join(', ')}`,
                    vscode.DiagnosticSeverity.Error
                )
            );
        }

        const nameCount = new Map<string, number>();
        for (const tag of parsedTags) {
            nameCount.set(tag.name, (nameCount.get(tag.name) ?? 0) + 1);
        }
        for (const [name, count] of nameCount) {
            if (count > 1) {
                const dup = parsedTags.find(t => t.name === name)!;
                out.push(
                    new vscode.Diagnostic(
                        new vscode.Range(dup.lineIndex, 0, dup.lineIndex, dup.raw.length),
                        `Duplicate tag '${name}'`,
                        vscode.DiagnosticSeverity.Warning
                    )
                );
            }
        }

        const hasFen = parsedTags.some(t => t.name === 'FEN');
        const hasSetup = parsedTags.some(t => t.name === 'SetUp');
        if (hasFen && !hasSetup) {
            const fenTag = parsedTags.find(t => t.name === 'FEN')!;
            out.push(
                new vscode.Diagnostic(
                    new vscode.Range(fenTag.lineIndex, 0, fenTag.lineIndex, fenTag.raw.length),
                    `FEN tag requires a matching SetUp "1" tag`,
                    vscode.DiagnosticSeverity.Warning
                )
            );
        }
    }

    private checkMovetext(
        game: GameSection,
        text: string,
        out: vscode.Diagnostic[]
    ) {
        const start = game.movetextStartOffset;
        const end = game.movetextEndOffset;
        if (start < 0 || end <= start) { return; }

        const movetext = text.slice(start, end);
        const lines = this.splitLinesWithOffsets(movetext);
        const baseLineIndex = this.offsetToLineIndex(text, start);

        let parenDepth = 0;
        let braceDepth = 0;
        let parenOpenLine = -1;
        let parenOpenChar = -1;
        let braceOpenLine = -1;
        let braceOpenChar = -1;

        let lastContentLine = -1;
        let lastContentChar = -1;
        let lastContentIsResult = false;
        let lastResultValue: string | null = null;

        let lastContentLength = 0;

        for (let li = 0; li < lines.length; li++) {
            const line = lines[li].text;
            const docLine = baseLineIndex + li;

            let ci = 0;
            while (ci < line.length) {
                const ch = line[ci];

                if (braceDepth > 0) {
                    if (ch === '}') {
                        braceDepth--;
                        if (braceDepth === 0) {
                            braceOpenLine = -1;
                            braceOpenChar = -1;
                        }
                    }
                    ci++;
                    continue;
                }

                if (ch === '{') {
                    braceDepth++;
                    if (braceDepth === 1) {
                        braceOpenLine = docLine;
                        braceOpenChar = ci;
                    }
                    ci++;
                    continue;
                }
                if (ch === '}') {
                    out.push(
                        new vscode.Diagnostic(
                            new vscode.Range(docLine, ci, docLine, ci + 1),
                            `Unmatched closing brace '}'`,
                            vscode.DiagnosticSeverity.Error
                        )
                    );
                    ci++;
                    continue;
                }
                if (ch === '(') {
                    parenDepth++;
                    if (parenDepth === 1) {
                        parenOpenLine = docLine;
                        parenOpenChar = ci;
                    }
                    ci++;
                    continue;
                }
                if (ch === ')') {
                    parenDepth--;
                    if (parenDepth < 0) {
                        out.push(
                            new vscode.Diagnostic(
                                new vscode.Range(docLine, ci, docLine, ci + 1),
                                `Unmatched closing parenthesis ')'`,
                                vscode.DiagnosticSeverity.Error
                            )
                        );
                        parenDepth = 0;
                    } else if (parenDepth === 0) {
                        parenOpenLine = -1;
                        parenOpenChar = -1;
                    }
                    ci++;
                    continue;
                }

                if (/\s/.test(ch)) {
                    ci++;
                    continue;
                }

                // Token-Anfang gefunden: Token bis zum nächsten Whitespace lesen
                const tokenStart = ci;
                while (ci < line.length && !/\s/.test(line[ci])) {
                    ci++;
                }
                const token = line.slice(tokenStart, ci);

                lastContentLine = docLine;
                lastContentChar = tokenStart;
                lastContentLength = token.length;

                if (token === '1-0' || token === '0-1' || token === '1/2-1/2' || token === '*') {
                    lastContentIsResult = true;
                    lastResultValue = token;
                } else {
                    lastContentIsResult = false;
                    lastResultValue = null;
                }
            }
        }

        if (parenDepth > 0 && parenOpenLine >= 0) {
            out.push(
                new vscode.Diagnostic(
                    new vscode.Range(parenOpenLine, parenOpenChar, parenOpenLine, parenOpenChar + 1),
                    `Unclosed variation: missing ')'`,
                    vscode.DiagnosticSeverity.Error
                )
            );
        }

        if (braceDepth > 0 && braceOpenLine >= 0) {
            out.push(
                new vscode.Diagnostic(
                    new vscode.Range(braceOpenLine, braceOpenChar, braceOpenLine, braceOpenChar + 1),
                    `Unclosed comment: missing '}'`,
                    vscode.DiagnosticSeverity.Error
                )
            );
        }

        if (lastContentLine < 0) {
            out.push(
                new vscode.Diagnostic(
                    new vscode.Range(baseLineIndex, 0, baseLineIndex, lines[0]?.text.length ?? 0),
                    `Empty movetext`,
                    vscode.DiagnosticSeverity.Error
                )
            );
            return;
        }

        const lastTokenText = lines[lastContentLine - baseLineIndex].text.slice(
            lastContentChar,
            lastContentChar + lastContentLength
        );

        if (!lastContentIsResult || lastResultValue === null) {
            const markerLike =
                /^[0-9/\-]+$/.test(lastTokenText) && /[-\/]/.test(lastTokenText);
            const message = markerLike
                ? `Invalid game termination marker '${lastTokenText}' (expected 1-0, 0-1, 1/2-1/2 or *)`
                : `Missing game termination marker (1-0, 0-1, 1/2-1/2 or *)`;
            out.push(
                new vscode.Diagnostic(
                    new vscode.Range(
                        lastContentLine,
                        lastContentChar,
                        lastContentLine,
                        lastContentChar + lastContentLength
                    ),
                    message,
                    vscode.DiagnosticSeverity.Error
                )
            );
            return;
        }

        if (!lastContentIsResult || lastResultValue === null) {
            out.push(
                new vscode.Diagnostic(
                    new vscode.Range(lastContentLine, lastContentChar, lastContentLine, lastContentChar + 1),
                    `Missing game termination marker (1-0, 0-1, 1/2-1/2 or *)`,
                    vscode.DiagnosticSeverity.Error
                )
            );
            return;
        }

        const resultTag = game.tags.find(t => t.raw.match(/^\[\s*Result\s/));
        if (resultTag) {
            const tagMatch = resultTag.raw.match(/^\[\s*Result\s+"((?:[^"\\]|\\.)*)"\s*\]/);
            if (tagMatch) {
                const tagValue = tagMatch[1];
                if (tagValue !== lastResultValue) {
                    out.push(
                        new vscode.Diagnostic(
                            new vscode.Range(
                                lastContentLine,
                                lastContentChar,
                                lastContentLine,
                                lastContentChar + lastResultValue.length
                            ),
                            `Movetext result '${lastResultValue}' does not match Result tag '${tagValue}'`,
                            vscode.DiagnosticSeverity.Error
                        )
                    );
                }
            }
        }
    }
}

export const pgnValidator: LanguageValidator = new PgnValidator();
