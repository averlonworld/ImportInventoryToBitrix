import { useState, useEffect } from 'react';
import { useForm } from 'react-hook-form';
import toast from 'react-hot-toast';
import {
  getBitrixSettings,
  saveBitrixSettings,
  testBitrixConnection,
} from '../services/settings.api';
import {
  getDailySchedule,
  updateDailySchedule,
  triggerDailyImport,
} from '../services/import.api';
import type { DailyScheduleConfig } from '../types';

interface FormData {
  portalUrl: string;
  webhookUrl: string;
}

export default function BitrixSettings() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [webhookConfigured, setWebhookConfigured] = useState(false);
  const [connectionStatus, setConnectionStatus] = useState('UNKNOWN');
  const [lastTestedAt, setLastTestedAt] = useState<string | null>(null);
  const { register, handleSubmit, setValue, formState: { errors } } = useForm<FormData>();

  // Daily Schedule state
  const [scheduleConfig, setScheduleConfig] = useState<DailyScheduleConfig | null>(null);
  const [scheduleTime, setScheduleTime] = useState('02:00');
  const [scheduleEnabled, setScheduleEnabled] = useState(true);
  const [savingSchedule, setSavingSchedule] = useState(false);
  const [triggeringDaily, setTriggeringDaily] = useState(false);

  const loadDailySchedule = async () => {
    try {
      const res = await getDailySchedule();
      if (res.success && res.data) {
        setScheduleConfig(res.data);
        setScheduleTime(res.data.timeOfDay || '02:00');
        setScheduleEnabled(res.data.enabled ?? true);
      }
    } catch {
      // ignore
    }
  };

  useEffect(() => {
    const loadSettings = async () => {
      try {
        const res = await getBitrixSettings();
        if (res.success && res.data) {
          setValue('portalUrl', res.data.portalUrl || '');
          setWebhookConfigured(res.data.webhookConfigured);
          setConnectionStatus(res.data.connectionStatus);
          setLastTestedAt(res.data.lastTestedAt);
        }
      } catch (err: any) {
        toast.error(err.response?.data?.message || 'Failed to load settings');
      } finally {
        setLoading(false);
      }
    };
    loadSettings();
    loadDailySchedule();
  }, [setValue]);

  const onSubmit = async (data: FormData) => {
    setSaving(true);
    try {
      const res = await saveBitrixSettings({
        portalUrl: data.portalUrl,
        webhookUrl: data.webhookUrl || undefined,
      });
      if (res.success) {
        toast.success('Configuration saved successfully');
        setWebhookConfigured(true);
      } else {
        toast.error(res.message || 'Failed to save configuration');
      }
    } catch (err: any) {
      toast.error(err.response?.data?.message || 'Failed to save configuration');
    } finally {
      setSaving(false);
    }
  };

  const handleTest = async () => {
    setTesting(true);
    try {
      const res = await testBitrixConnection();
      if (res.success) {
        toast.success('Bitrix24 connection successful');
        setConnectionStatus('CONNECTED');
        setLastTestedAt(res.data?.lastTestedAt || new Date().toISOString());
      } else {
        toast.error(res.message || 'Unable to connect to Bitrix24');
        setConnectionStatus('FAILED');
      }
    } catch (err: any) {
      toast.error(err.response?.data?.message || 'Unable to connect to Bitrix24');
      setConnectionStatus('FAILED');
    } finally {
      setTesting(false);
    }
  };

  const handleSaveSchedule = async () => {
    setSavingSchedule(true);
    try {
      const res = await updateDailySchedule({
        enabled: scheduleEnabled,
        timeOfDay: scheduleTime,
      });
      if (res.success) {
        toast.success('Daily import schedule updated');
        loadDailySchedule();
      } else {
        toast.error('Failed to update schedule');
      }
    } catch {
      toast.error('Error saving schedule');
    } finally {
      setSavingSchedule(false);
    }
  };

  const handleTriggerDailyNow = async () => {
    setTriggeringDaily(true);
    try {
      const res = await triggerDailyImport();
      if (res.success) {
        toast.success(res.message || 'Daily import enqueued successfully!');
        loadDailySchedule();
      } else {
        toast.error(res.message || 'No pending inventory files found in feed folder.');
      }
    } catch (err: any) {
      toast.error(err.response?.data?.message || 'Error triggering daily import');
    } finally {
      setTriggeringDaily(false);
    }
  };

  if (loading) {
    return <div className="flex items-center gap-2 text-gray-600"><div className="animate-spin rounded-full h-5 w-5 border-b-2 border-blue-600"></div> Loading...</div>;
  }

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <h1 className="text-2xl font-bold text-gray-900">Bitrix24 Configuration</h1>

      <div className="card space-y-4">
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          <div>
            <label className="label">Bitrix Portal URL</label>
            <input
              type="url"
              {...register('portalUrl', { required: 'Portal URL is required' })}
              className="input-field"
              placeholder="https://your-company.bitrix24.com"
            />
            {errors.portalUrl && <p className="mt-1 text-sm text-red-600">{errors.portalUrl.message}</p>}
          </div>

          <div>
            <label className="label">
              Bitrix Webhook URL
              {webhookConfigured ? (
                <span className="ml-2 text-xs text-green-600 bg-green-50 px-2 py-0.5 rounded">Webhook configured</span>
              ) : null}
            </label>
            <input
              type="text"
              {...register('webhookUrl')}
              className="input-field font-mono"
              placeholder={webhookConfigured ? '******************************' : 'https://your-company.bitrix24.com/rest/USER_ID/TOKEN/'}
            />
            {webhookConfigured && (
              <p className="text-xs text-gray-500 mt-1">
                A webhook is already configured. Enter a new one to replace it, or leave blank to keep the existing.
              </p>
            )}
          </div>

          <div className="flex gap-3">
            <button
              type="submit"
              disabled={saving}
              className="btn-primary"
            >
              {saving ? 'Saving...' : 'Save Configuration'}
            </button>
            <button
              type="button"
              onClick={handleTest}
              disabled={testing || !webhookConfigured}
              className="btn-secondary"
            >
              {testing ? 'Testing connection...' : 'Test Connection'}
            </button>
          </div>
        </form>

        <div className="border-t border-gray-200 pt-4">
          <h3 className="text-sm font-medium text-gray-700 mb-3">Connection Status</h3>
          <div className="flex items-center gap-2">
            <div className={`w-3 h-3 rounded-full ${
              connectionStatus === 'CONNECTED' ? 'bg-green-500' :
              connectionStatus === 'FAILED' ? 'bg-red-500' : 'bg-gray-400'
            }`} />
            <span className="text-sm font-medium">
              {connectionStatus === 'CONNECTED' ? 'Connected' :
               connectionStatus === 'FAILED' ? 'Failed' : 'Not tested'}
            </span>
          </div>
          {lastTestedAt && (
            <p className="text-xs text-gray-500 mt-1">
              Last Tested: {new Date(lastTestedAt).toLocaleString()}
            </p>
          )}
        </div>
      </div>

      {!webhookConfigured && (
        <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4 text-sm text-yellow-800">
          <strong>Note:</strong> You must configure a valid Bitrix webhook URL to import products/inventory. The webhook is stored securely (encrypted) in our database and is never exposed to the frontend.
        </div>
      )}

      {/* Automated Daily Import Schedule Card (Requirement 1) */}
      <div className="card space-y-4">
        <div className="border-b border-gray-200 pb-3">
          <h2 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
            <svg className="w-5 h-5 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            Automated Daily Import Schedule (Requirement 1)
          </h2>
          <p className="text-xs text-gray-500 mt-0.5">
            Configures the automated daily inventory feed. Drop your daily Excel spreadsheet into the feed folder, and the middleware imports it automatically.
          </p>
        </div>

        <div className="space-y-4 text-sm">
          <div className="flex items-center justify-between">
            <div>
              <span className="font-medium text-gray-700 block">Daily Scheduled Execution</span>
              <span className="text-xs text-gray-500">Automatically trigger once every day at specified time</span>
            </div>
            <label className="relative inline-flex items-center cursor-pointer">
              <input
                type="checkbox"
                checked={scheduleEnabled}
                onChange={(e) => setScheduleEnabled(e.target.checked)}
                className="sr-only peer"
              />
              <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-blue-600"></div>
            </label>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Execution Time (24h format)</label>
              <input
                type="time"
                value={scheduleTime}
                onChange={(e) => setScheduleTime(e.target.value)}
                className="input-field"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Files Waiting in Feed</label>
              <div className="px-3 py-2 bg-gray-50 rounded border text-xs font-mono flex items-center justify-between">
                <span>{scheduleConfig?.feedFileCount ?? 0} file(s) waiting</span>
                <span className="text-gray-400">uploads/daily_feed/</span>
              </div>
            </div>
          </div>

          {scheduleConfig?.lastRunAt && (
            <div className="p-3 bg-gray-50 rounded text-xs text-gray-600 flex justify-between items-center">
              <div>
                <strong>Last Run:</strong> {new Date(scheduleConfig.lastRunAt).toLocaleString()}
                {scheduleConfig.lastFileName && <span className="ml-1 text-gray-500">({scheduleConfig.lastFileName})</span>}
              </div>
              <span className={`px-2 py-0.5 rounded font-bold text-[10px] ${
                scheduleConfig.lastRunStatus === 'QUEUED' ? 'bg-green-100 text-green-800' : 'bg-gray-200 text-gray-700'
              }`}>
                {scheduleConfig.lastRunStatus || 'IDLE'}
              </span>
            </div>
          )}

          <div className="flex gap-3 pt-2">
            <button
              type="button"
              onClick={handleSaveSchedule}
              disabled={savingSchedule}
              className="btn-primary"
            >
              {savingSchedule ? 'Saving...' : 'Update Schedule'}
            </button>

            <button
              type="button"
              onClick={handleTriggerDailyNow}
              disabled={triggeringDaily}
              className="btn-secondary"
            >
              {triggeringDaily ? 'Triggering...' : 'Run Daily Import Now'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

