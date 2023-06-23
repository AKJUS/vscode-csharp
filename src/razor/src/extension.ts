﻿/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 * ------------------------------------------------------------------------------------------ */

import * as vscode from 'vscode';
import * as vscodeapi from 'vscode';
import { ExtensionContext } from 'vscode';
import { BlazorDebugConfigurationProvider } from './BlazorDebug/BlazorDebugConfigurationProvider';
import { CodeActionsHandler } from './CodeActions/CodeActionsHandler';
import { RazorCodeActionRunner } from './CodeActions/RazorCodeActionRunner';
import { RazorCodeLensProvider } from './CodeLens/RazorCodeLensProvider';
import { ColorPresentationHandler } from './ColorPresentation/ColorPresentationHandler';
import { ProvisionalCompletionOrchestrator } from './Completion/ProvisionalCompletionOrchestrator';
import { RazorCompletionItemProvider } from './Completion/RazorCompletionItemProvider';
import { listenToConfigurationChanges } from './ConfigurationChangeListener';
import { RazorCSharpFeature } from './CSharp/RazorCSharpFeature';
import { RazorDefinitionProvider } from './Definition/RazorDefinitionProvider';
import { ReportIssueCommand } from './Diagnostics/ReportIssueCommand';
import { RazorDocumentManager } from './Document/RazorDocumentManager';
import { RazorDocumentSynchronizer } from './Document/RazorDocumentSynchronizer';
import { DocumentColorHandler } from './DocumentColor/DocumentColorHandler';
import { RazorDocumentHighlightProvider } from './DocumentHighlight/RazorDocumentHighlightProvider';
import { reportTelemetryForDocuments } from './DocumentTelemetryListener';
import { DynamicFileInfoHandler } from './DynamicFile/DynamicFileInfoHandler';
import { FoldingRangeHandler } from './Folding/FoldingRangeHandler';
import { FormattingHandler } from './Formatting/FormattingHandler';
import { HostEventStream } from './HostEventStream';
import { RazorHoverProvider } from './Hover/RazorHoverProvider';
import { RazorHtmlFeature } from './Html/RazorHtmlFeature';
import { IEventEmitterFactory } from './IEventEmitterFactory';
import { RazorImplementationProvider } from './Implementation/RazorImplementationProvider';
import { ProposedApisFeature } from './ProposedApisFeature';
import { RazorLanguage } from './RazorLanguage';
import { RazorLanguageConfiguration } from './RazorLanguageConfiguration';
import { RazorLanguageServerClient } from './RazorLanguageServerClient';
import { resolveRazorLanguageServerTrace } from './RazorLanguageServerTraceResolver';
import { RazorLanguageServiceClient } from './RazorLanguageServiceClient';
import { RazorLogger } from './RazorLogger';
import { RazorReferenceProvider } from './Reference/RazorReferenceProvider';
import { RazorRenameProvider } from './Rename/RazorRenameProvider';
import { SemanticTokensRangeHandler } from './Semantic/SemanticTokensRangeHandler';
import { RazorSignatureHelpProvider } from './SignatureHelp/RazorSignatureHelpProvider';
import { TelemetryReporter } from './TelemetryReporter';
import { RazorDiagnosticHandler } from './Diagnostics/RazorDiagnosticHandler';
import { PlatformInformation } from '../../shared/platform';
import createOptionStream from '../../shared/observables/CreateOptionStream';
import OptionProvider from '../../shared/observers/OptionProvider';

// We specifically need to take a reference to a particular instance of the vscode namespace,
// otherwise providers attempt to operate on the null extension.
export async function activate(vscodeType: typeof vscodeapi, context: ExtensionContext, languageServerDir: string, eventStream: HostEventStream, enableProposedApis = false) {
    const telemetryReporter = new TelemetryReporter(eventStream);
    const eventEmitterFactory: IEventEmitterFactory = {
        create: <T>() => new vscode.EventEmitter<T>(),
    };

    const optionStream = createOptionStream(vscode);
    let optionProvider = new OptionProvider(optionStream);
    const languageServerTrace = resolveRazorLanguageServerTrace(vscodeType);
    const logger = new RazorLogger(vscodeType, eventEmitterFactory, languageServerTrace);

    try {
        const platformInfo = await PlatformInformation.GetCurrent();
        const languageServerClient = new RazorLanguageServerClient(vscodeType, languageServerDir, telemetryReporter, platformInfo, optionProvider, logger);
        const languageServiceClient = new RazorLanguageServiceClient(languageServerClient);

        const documentManager = new RazorDocumentManager(languageServerClient, logger);
        const documentSynchronizer = new RazorDocumentSynchronizer(documentManager, logger);
        reportTelemetryForDocuments(documentManager, telemetryReporter);
        const languageConfiguration = new RazorLanguageConfiguration();
        const csharpFeature = new RazorCSharpFeature(documentManager, eventEmitterFactory, logger);
        const htmlFeature = new RazorHtmlFeature(documentManager, languageServiceClient, eventEmitterFactory, logger);
        const localRegistrations: vscode.Disposable[] = [];
        const reportIssueCommand = new ReportIssueCommand(vscodeType, documentManager, logger);
        const razorCodeActionRunner = new RazorCodeActionRunner(languageServerClient, logger);
        const codeActionsHandler = new CodeActionsHandler(documentManager, documentSynchronizer, languageServerClient, logger);

        // Our dynamic file handler needs to be registered regardless of whether the Razor language server starts
        // since the Roslyn implementation expects the dynamic file commands to always be registered.
        const dynamicFileInfoProvider = new DynamicFileInfoHandler(
            documentManager,
            logger);
        dynamicFileInfoProvider.register();

        languageServerClient.onStart(async () => {
            const provisionalCompletionOrchestrator = new ProvisionalCompletionOrchestrator(
                documentManager,
                csharpFeature.projectionProvider,
                languageServiceClient,
                logger);
            const semanticTokenHandler = new SemanticTokensRangeHandler(languageServerClient);
            const colorPresentationHandler = new ColorPresentationHandler(
                documentManager,
                languageServerClient,
                logger);
            const documentColorHandler = new DocumentColorHandler(
                documentManager,
                documentSynchronizer,
                languageServerClient,
                logger);
            const foldingRangeHandler = new FoldingRangeHandler(
                languageServerClient,
                documentManager,
                logger);
            const formattingHandler = new FormattingHandler(
                documentManager,
                documentSynchronizer,
                languageServerClient,
                logger);

            const completionItemProvider = new RazorCompletionItemProvider(
                documentSynchronizer,
                documentManager,
                languageServiceClient,
                provisionalCompletionOrchestrator,
                logger);
            const signatureHelpProvider = new RazorSignatureHelpProvider(
                documentSynchronizer,
                documentManager,
                languageServiceClient,
                logger);
            const definitionProvider = new RazorDefinitionProvider(
                documentSynchronizer,
                documentManager,
                languageServiceClient,
                logger);
            const implementationProvider = new RazorImplementationProvider(
                documentSynchronizer,
                documentManager,
                languageServiceClient,
                logger);
            const hoverProvider = new RazorHoverProvider(
                documentSynchronizer,
                documentManager,
                languageServiceClient,
                logger);
            const codeLensProvider = new RazorCodeLensProvider(
                documentSynchronizer,
                documentManager,
                languageServiceClient,
                logger);
            const renameProvider = new RazorRenameProvider(
                documentSynchronizer,
                documentManager,
                languageServiceClient,
                logger);
            const referenceProvider = new RazorReferenceProvider(
                documentSynchronizer,
                documentManager,
                languageServiceClient,
                logger);
            const documentHighlightProvider = new RazorDocumentHighlightProvider(
                documentSynchronizer,
                documentManager,
                languageServiceClient,
                logger);
            const razorDiagnosticHandler = new RazorDiagnosticHandler(documentSynchronizer, languageServerClient, languageServiceClient, documentManager, logger);

            localRegistrations.push(
                languageConfiguration.register(),
                provisionalCompletionOrchestrator.register(),
                vscodeType.languages.registerCompletionItemProvider(
                    RazorLanguage.id,
                    completionItemProvider,
                    '.', '<', '@'),
                vscodeType.languages.registerSignatureHelpProvider(
                    RazorLanguage.id,
                    signatureHelpProvider,
                    '(', ','),
                vscodeType.languages.registerDefinitionProvider(
                    RazorLanguage.id,
                    definitionProvider),
                vscodeType.languages.registerImplementationProvider(
                    RazorLanguage.id,
                    implementationProvider),
                vscodeType.languages.registerHoverProvider(
                    RazorLanguage.documentSelector,
                    hoverProvider),
                vscodeType.languages.registerReferenceProvider(
                    RazorLanguage.id,
                    referenceProvider),
                vscodeType.languages.registerCodeLensProvider(
                    RazorLanguage.id,
                    codeLensProvider),
                vscodeType.languages.registerRenameProvider(
                    RazorLanguage.id,
                    renameProvider),
                vscodeType.languages.registerDocumentHighlightProvider(
                    RazorLanguage.id,
                    documentHighlightProvider),
                documentManager.register(),
                csharpFeature.register(),
                htmlFeature.register(),
                documentSynchronizer.register(),
                reportIssueCommand.register(),
                listenToConfigurationChanges(languageServerClient));

            if (enableProposedApis) {
                const proposedApisFeature = new ProposedApisFeature();

                await proposedApisFeature.register(vscodeType, localRegistrations);
            }

            razorCodeActionRunner.register();

            await Promise.all([
                colorPresentationHandler.register(),
                documentColorHandler.register(),
                foldingRangeHandler.register(),
                formattingHandler.register(),
                semanticTokenHandler.register(),
                razorDiagnosticHandler.register(),
                codeActionsHandler.register()
            ]);
        });

        const onStopRegistration = languageServerClient.onStop(() => {
            localRegistrations.forEach(r => r.dispose());
            localRegistrations.length = 0;
        });

        const provider = new BlazorDebugConfigurationProvider(logger, vscodeType);
        context.subscriptions.push(vscodeType.debug.registerDebugConfigurationProvider('blazorwasm', provider));

        languageServerClient.onStarted(async () => {
            await documentManager.initialize();
        });

        await startLanguageServer(vscodeType, languageServerClient, logger, context);

        context.subscriptions.push(languageServerClient, onStopRegistration, logger);
    } catch (error) {
        logger.logError('Failed when activating Razor VSCode.', error as Error);
        telemetryReporter.reportErrorOnActivation(error as Error);
    }
}

async function startLanguageServer(
    vscodeType: typeof vscodeapi,
    languageServerClient: RazorLanguageServerClient,
    logger: RazorLogger,
    context: vscode.ExtensionContext) {

    const razorFiles = await vscodeType.workspace.findFiles(RazorLanguage.globbingPattern);
    if (razorFiles.length === 0) {
        // No Razor files in workspace, language server should stay off until one is added or opened.
        logger.logAlways('No Razor files detected in workspace, delaying language server start.');

        const watcher = vscodeType.workspace.createFileSystemWatcher(RazorLanguage.globbingPattern);
        const delayedLanguageServerStart = async () => {
            razorFileCreatedRegistration.dispose();
            razorFileOpenedRegistration.dispose();
            await languageServerClient.start();
        };
        const razorFileCreatedRegistration = watcher.onDidCreate(async () => delayedLanguageServerStart());
        const razorFileOpenedRegistration = vscodeType.workspace.onDidOpenTextDocument(async (event) => {
            if (event.languageId === RazorLanguage.id) {
                await delayedLanguageServerStart();
            }
        });
        context.subscriptions.push(razorFileCreatedRegistration, razorFileOpenedRegistration);
    } else {
        await languageServerClient.start();
    }
}
