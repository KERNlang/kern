'use client';

import { useTranslation } from 'react-i18next';
import { Icon, Button } from '@components/ui';
import { MasteringDefaultsSection } from './MasteringDefaultsSection';
import { AudioDeviceSelector } from './AudioDeviceSelector';
import { ExportDefaultsSection } from './ExportDefaultsSection';
import { PresetSelector } from './PresetSelector';
import { StemThresholdSlider } from './StemThresholdSlider';
import { ToleranceSliders } from './ToleranceSliders';

export function AudioSettings() {
  const { t } = useTranslation();

  return (
    <div className="space-y-8">
      <div>
        <h3 className="text-sm font-medium text-white mb-4">
          {t('masteringDefaults.title', 'Mastering Defaults')}
        </h3>
        <span className="text-xs text-zinc-500 mb-3">{t('setYourPreferredStartingPointForTheMasteringChain', 'Set your preferred starting point for the mastering chain.')}</span>
        <MasteringDefaultsSection />
      </div>
      <div className="bg-zinc-800 h-px" />
      <div>
        <h3 className="text-sm font-medium text-white mb-4">
          {t('audioOutput.title', 'Audio Output')}
        </h3>
        <AudioDeviceSelector value={settings.audioOutputDeviceId} onChange={setAudioOutputDeviceId} />
      </div>
      <div>
        <h3 className="text-sm font-medium text-white mb-4">
          {t('exportDefaults.title', 'Export Defaults')}
        </h3>
        <span className="text-xs text-zinc-500 mb-3">{t('setYourPreferredExportFormat', 'Set your preferred export format.')}</span>
        <ExportDefaultsSection isPro={isPro} exportFormat={exportFormat} mp3Bitrate={mp3Bitrate} />
      </div>
      <div className="bg-zinc-800 h-px" />
      <div>
        <h3 className="text-sm font-medium text-white mb-4">
          {t('defaultAnalysisSensitivity.title', 'Default Analysis Sensitivity')}
        </h3>
        <div className="bg-zinc-900 rounded-2 p-4 border border-[#27272a]">
          <PresetSelector value={presetId} onChange={setPresetId} onChange={selectPreset} isPro={isPro} />
          <span className="text-xs text-zinc-500 mt-2">{t('thisPresetWillBeUsedAsTheStartingPointWhenAnalyzingNewTracks', 'This preset will be used as the starting point when analyzing new tracks.')}</span>
        </div>
      </div>
      <div>
        <div className="flex items-center gap-2 mb-4">
          <h3 className="text-sm font-medium text-white">
            {t('fixStrength.title', 'Fix Strength')}
          </h3>
          <div className="relative group">
            <Icon name="infoCircle" size="sm" className="text-zinc-500 hover:text-orange-500 cursor-help transition-colors" />
            <div className="absolute left-0 bottom-full mb-2 hidden group-hover:block z-50 w-72 p-3 bg-zinc-900 border border-zinc-700 rounded-lg shadow-xl text-xs text-zinc-300">
              {/* tooltip content */}
            </div>
          </div>
        </div>
        <div className="bg-zinc-900 rounded-2 p-4 border border-[#27272a]">
          <div className="justify-between items-center mb-4 flex">
            <span className="text-sm text-zinc-400">{t('controlsHowAggressiveAutoFixEqCutsAreApplied', 'Controls how aggressive auto-fix EQ cuts are applied.')}</span>
            <span className="text-sm text-orange-500 font-medium">{`${fixStrengthDb.toFixed(1)} dB (${presetLabel})`}</span>
          </div>
          <input
            type="range"
            min={2}
            max={6}
            step={0.1}
            value={fixStrengthDb}
            onChange={(e) => setFixStrengthDb(parseFloat(e.target.value))}
           onDoubleClick={() => setFixStrengthDb(4.0)}
            className="w-full h-2 bg-zinc-700 rounded-lg appearance-none cursor-pointer accent-[#f97316]"
          />
          <div className="justify-between mt-1 flex">
            <span className="text-xs text-zinc-500">{t('conservative2db', 'Conservative (2dB)')}</span>
            <span className="text-xs text-zinc-500">{t('industryStandard4db', 'Industry Standard (4dB)')}</span>
            <span className="text-xs text-zinc-500">{t('aggressive6db', 'Aggressive (6dB)')}</span>
          </div>
          <span className="text-xs text-zinc-500 mt-3">{strengthDescription}</span>
        </div>
      </div>
      <div>
        <div className="flex items-center gap-2 mb-4">
          <h3 className="text-sm font-medium text-white">
            {t('stemPresenceThreshold.title', 'Stem Presence Threshold')}
          </h3>
          <div className="relative group">
            <Icon name="infoCircle" size="sm" className="text-zinc-500 hover:text-orange-500 cursor-help transition-colors" />
            <div className="absolute left-0 bottom-full mb-2 hidden group-hover:block z-50 w-72 p-3 bg-zinc-900 border border-zinc-700 rounded-lg shadow-xl text-xs text-zinc-300">
              {/* tooltip content */}
            </div>
          </div>
        </div>
        <div className="bg-zinc-900 rounded-2 p-4 border border-[#27272a]">
          <span className="text-sm text-zinc-400 mb-4">{t('stemsQuieterThanThisThresholdAreConsideredNotPresentAndSkipped', 'Stems quieter than this threshold are considered not present and skipped.')}</span>
          <div className="justify-between items-center mb-2 flex">
            <span className="text-sm text-zinc-300">{t('threshold', 'Threshold')}</span>
            <span className="text-sm text-orange-500 font-medium">{`${presenceThreshold.toFixed(1)} LUFS`}</span>
          </div>
          <input
            type="range"
            min={-80}
            max={-30}
            step={5}
            value={presenceThreshold}
            onChange={(e) => setPresenceThreshold(parseFloat(e.target.value))}
            className="w-full h-2 bg-zinc-700 rounded-lg appearance-none cursor-pointer accent-[#f97316]"
          />
          <div className="justify-between mt-1 flex">
            <span className="text-xs text-zinc-500">{t('80Sensitive', '-80 (Sensitive)')}</span>
            <span className="text-xs text-zinc-500">{t('40Standard', '-40 (Standard)')}</span>
            <span className="text-xs text-zinc-500">{t('30Strict', '-30 (Strict)')}</span>
          </div>
          <div className="bg-zinc-950 rounded-2 p-3 mt-4 border border-[#27272a]">
            <span className="text-xs text-zinc-400 font-medium mb-1">{t('currentSetting', 'Current setting:')}</span>
            <span className="text-xs text-zinc-500">{presenceDescription}</span>
          </div>
        </div>
      </div>
      <div>
        <div className="flex items-center gap-2 mb-4">
          <h3 className="text-sm font-medium text-white">
            {t('perStemDetectionThresholds.title', 'Per-Stem Detection Thresholds')}
          </h3>
          <div className="relative group">
            <Icon name="infoCircle" size="sm" className="text-zinc-500 hover:text-orange-500 cursor-help transition-colors" />
            <div className="absolute left-0 bottom-full mb-2 hidden group-hover:block z-50 w-72 p-3 bg-zinc-900 border border-zinc-700 rounded-lg shadow-xl text-xs text-zinc-300">
              {/* tooltip content */}
            </div>
          </div>
        </div>
        <div className="bg-zinc-900 rounded-2 p-4 border border-[#27272a]">
          <span className="text-sm text-zinc-400 mb-4">{t('industryInformedThresholdsForEachStemType', 'Industry-informed thresholds for each stem type.')}</span>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <StemThresholdSlider stem={"drums"} value={perStemThresholds.drums} onChange={setDrums} default={"-30"} disabled={!isPro} />
            <StemThresholdSlider stem={"bass"} value={perStemThresholds.bass} onChange={setBass} default={"-35"} disabled={!isPro} />
            <StemThresholdSlider stem={"vocals"} value={perStemThresholds.vocals} onChange={setVocals} default={"-30"} disabled={!isPro} />
            <StemThresholdSlider stem={"guitar"} value={perStemThresholds.guitar} onChange={setGuitar} default={"-45"} disabled={!isPro} />
            <StemThresholdSlider stem={"piano"} value={perStemThresholds.piano} onChange={setPiano} default={"-45"} disabled={!isPro} />
            <StemThresholdSlider stem={"other"} value={perStemThresholds.other} onChange={setOther} default={"-50"} disabled={!isPro} />
          </div>
          {isPro && perStemMode === 'manual' && (
            <>
              <div className="bg-zinc-800 mt-4 h-px" />
              <Button variant="secondary" size="sm" onClick={resetPerStemThresholds}>
                <Icon name="rotate" size="sm" className="mr-2" />
                {t('resetToIndustryDefaults', 'Reset to Industry Defaults')}
              </Button>
            </>
          )}
          {!isPro && (
            <>
              <div className="bg-zinc-800 mt-4 h-px" />
              <div className="bg-zinc-950 rounded-2 p-3 mt-4 border border-[#27272a]">
                <div className="gap-3 flex">
                  <Icon name="lock" size="sm" className="text-orange-500" />
                  <div className="flex flex-col">
                    <span className="text-sm text-zinc-300 font-medium mb-1">{t('proFeature', 'Pro Feature')}</span>
                    <span className="text-sm text-zinc-400">{t('upgradeToCustomizeIndividualStemThresholds', 'Upgrade to customize individual stem thresholds.')}</span>
                  </div>
                </div>
              </div>
            </>
          )}
        </div>
      </div>
      {isPro && (
        <>
          <div>
            <h3 className="text-sm font-medium text-white mb-4">
              {t('customThresholdsConfiguration.title', 'Custom Thresholds Configuration')}
            </h3>
            <div className="bg-zinc-900 rounded-2 p-6 border border-[#27272a]">
              <span className="text-sm text-zinc-300 mb-4">{t('fineTuneTheToleranceLevelsForTheCustomPreset', 'Fine-tune the tolerance levels for the Custom preset.')}</span>
              <ToleranceSliders value={customThresholds} onChange={setCustomThresholds} onChange={setThreshold} disabled={!isPro} />
            </div>
          </div>
        </>
      )}
      <div className="bg-zinc-800 h-px" />
      <div>
        <h3 className="text-sm font-medium text-white mb-4">
          {t('signalProcessing.title', 'Signal Processing')}
        </h3>
        <div className="bg-zinc-900 rounded-2 p-4 border border-[#27272a]">
          <div className="justify-between items-center flex">
            <div className="flex flex-col">
              <span className="text-sm text-zinc-200 mb-1">{t('normalizeReferenceLoudness', 'Normalize Reference Loudness')}</span>
              <span className="text-xs text-zinc-500">{t('automaticallyAdjustReferenceTrackGainToMatchYourMixLufsMatching', 'Automatically adjust reference track gain to match your mix (LUFS matching).')}</span>
            </div>
            <label className="relative inline-flex items-center cursor-pointer">
              <input
                type="checkbox"
                className="sr-only peer"
                checked={normalizeReference}
                onChange={(e) => setNormalizeReference(e.target.checked)}
              />
              <div className="w-11 h-6 bg-zinc-700 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-orange-600" />
            </label>
          </div>
        </div>
      </div>
    </div>
  );
}