'use client';

import { useState, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Bell, BellOff, Plus, X, Clock } from 'lucide-react';
import { useLocale } from '@/hooks/use-locale';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface Reminder {
  id: string;
  value: number;
  unit: 'minute' | 'hour' | 'day' | 'week' | 'month';
}

interface PresetReminder {
  id: string;
  value: number;
  unit: 'minute' | 'hour' | 'day';
  labelKey: keyof typeof import('@/lib/i18n').ko.notification;
}

// ---------------------------------------------------------------------------
// Preset definitions
// ---------------------------------------------------------------------------

const PRESET_REMINDERS: PresetReminder[] = [
  { id: 'preset-5min', value: 5, unit: 'minute', labelKey: 'reminder5min' },
  { id: 'preset-10min', value: 10, unit: 'minute', labelKey: 'reminder10min' },
  { id: 'preset-30min', value: 30, unit: 'minute', labelKey: 'reminder30min' },
  { id: 'preset-1hour', value: 1, unit: 'hour', labelKey: 'reminder1hour' },
  { id: 'preset-1day', value: 1, unit: 'day', labelKey: 'reminder1day' },
];

const UNIT_KEYS: Record<Reminder['unit'], keyof typeof import('@/lib/i18n').ko.notification> = {
  minute: 'minute',
  hour: 'hour',
  day: 'day',
  week: 'week',
  month: 'month',
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let nextId = 1;
function uid() {
  return `reminder-${nextId++}-${Date.now()}`;
}

function formatReminder(
  r: Reminder,
  t: ReturnType<typeof useLocale>['t'],
) {
  const unitLabel = t.notification[UNIT_KEYS[r.unit]];
  return `${r.value} ${unitLabel} ${t.notification.reminderBefore}`;
}

// ---------------------------------------------------------------------------
// Animation variants
// ---------------------------------------------------------------------------

const containerVariants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: { staggerChildren: 0.06 },
  },
};

const itemVariants = {
  hidden: { opacity: 0, y: 8 },
  visible: { opacity: 1, y: 0 },
  exit: { opacity: 0, y: -4, transition: { duration: 0.15 } },
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function NotificationSettings() {
  const { t } = useLocale();

  // ---- state ---------------------------------------------------------------
  const [notificationsEnabled, setNotificationsEnabled] = useState(true);
  const [activeReminders, setActiveReminders] = useState<Reminder[]>([]);
  const [customValue, setCustomValue] = useState('');
  const [customUnit, setCustomUnit] = useState<Reminder['unit']>('minute');

  // ---- handlers ------------------------------------------------------------
  const togglePreset = useCallback((preset: PresetReminder) => {
    setActiveReminders((prev) => {
      const exists = prev.some(
        (r) => r.value === preset.value && r.unit === preset.unit,
      );
      if (exists) {
        return prev.filter(
          (r) => !(r.value === preset.value && r.unit === preset.unit),
        );
      }
      return [...prev, { id: uid(), value: preset.value, unit: preset.unit }];
    });
  }, []);

  const isPresetActive = useCallback(
    (preset: PresetReminder) =>
      activeReminders.some(
        (r) => r.value === preset.value && r.unit === preset.unit,
      ),
    [activeReminders],
  );

  const addCustomReminder = useCallback(() => {
    const num = parseInt(customValue, 10);
    if (isNaN(num) || num < 1 || num > 60) return;
    // avoid duplicates
    const exists = activeReminders.some(
      (r) => r.value === num && r.unit === customUnit,
    );
    if (exists) return;
    setActiveReminders((prev) => [
      ...prev,
      { id: uid(), value: num, unit: customUnit },
    ]);
    setCustomValue('');
  }, [customValue, customUnit, activeReminders]);

  const removeReminder = useCallback((id: string) => {
    setActiveReminders((prev) => prev.filter((r) => r.id !== id));
  }, []);

  // ---- render --------------------------------------------------------------
  return (
    <motion.div
      className="mx-auto max-w-xl space-y-4"
      variants={containerVariants}
      initial="hidden"
      animate="visible"
    >
      {/* 1. Global Notification Toggle */}
      <motion.div variants={itemVariants}>
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-sm font-semibold">
              {notificationsEnabled ? (
                <Bell className="size-4 text-primary" />
              ) : (
                <BellOff className="size-4 text-muted-foreground" />
              )}
              {t.notification.title}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-center justify-between">
              <Label className="text-sm">
                {t.notification.addReminder}
              </Label>
              <Switch
                checked={notificationsEnabled}
                onCheckedChange={setNotificationsEnabled}
              />
            </div>
          </CardContent>
        </Card>
      </motion.div>

      <AnimatePresence mode="wait">
        {notificationsEnabled && (
          <motion.div
            key="notification-body"
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.25 }}
            className="space-y-4 overflow-hidden"
          >
            {/* 2. Default Reminders (presets) */}
            <motion.div variants={itemVariants}>
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="flex items-center gap-2 text-sm font-semibold">
                    <Clock className="size-4 text-muted-foreground" />
                    {t.notification.addReminder}
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="flex flex-wrap gap-2">
                    {PRESET_REMINDERS.map((preset) => {
                      const active = isPresetActive(preset);
                      return (
                        <motion.button
                          key={preset.id}
                          type="button"
                          whileTap={{ scale: 0.95 }}
                          onClick={() => togglePreset(preset)}
                        >
                          <Badge
                            variant={active ? 'default' : 'outline'}
                            className="cursor-pointer select-none px-3 py-1.5 text-sm transition-colors"
                          >
                            {t.notification[preset.labelKey]}
                          </Badge>
                        </motion.button>
                      );
                    })}
                  </div>
                </CardContent>
              </Card>
            </motion.div>

            {/* 3. Custom Reminder Form */}
            <motion.div variants={itemVariants}>
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="flex items-center gap-2 text-sm font-semibold">
                    <Plus className="size-4 text-muted-foreground" />
                    {t.notification.addReminder}
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="flex items-end gap-2">
                    <div className="flex flex-col gap-1.5">
                      <Label className="sr-only">Number</Label>
                      <Input
                        type="number"
                        min={1}
                        max={60}
                        value={customValue}
                        onChange={(e) => setCustomValue(e.target.value)}
                        placeholder="1"
                        className="w-20 text-center"
                      />
                    </div>

                    <div className="flex flex-col gap-1.5">
                      <Label className="sr-only">Unit</Label>
                      <Select
                        value={customUnit}
                        onValueChange={(v) =>
                          setCustomUnit(v as Reminder['unit'])
                        }
                      >
                        <SelectTrigger className="w-24">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="minute">
                            {t.notification.minute}
                          </SelectItem>
                          <SelectItem value="hour">
                            {t.notification.hour}
                          </SelectItem>
                          <SelectItem value="day">
                            {t.notification.day}
                          </SelectItem>
                          <SelectItem value="week">
                            {t.notification.week}
                          </SelectItem>
                          <SelectItem value="month">
                            {t.notification.month}
                          </SelectItem>
                        </SelectContent>
                      </Select>
                    </div>

                    <Button
                      size="sm"
                      onClick={addCustomReminder}
                      disabled={
                        !customValue ||
                        isNaN(parseInt(customValue, 10)) ||
                        parseInt(customValue, 10) < 1 ||
                        parseInt(customValue, 10) > 60
                      }
                    >
                      <Plus className="mr-1 size-4" />
                      {t.common.add}
                    </Button>
                  </div>
                </CardContent>
              </Card>
            </motion.div>

            {/* 4. Active Reminders List */}
            <motion.div variants={itemVariants}>
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm font-semibold">
                    {t.notification.addReminder}
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  {activeReminders.length === 0 ? (
                    <p className="py-4 text-center text-sm text-muted-foreground">
                      {t.notification.noReminders}
                    </p>
                  ) : (
                    <motion.ul
                      className="max-h-64 space-y-2 overflow-y-auto pr-1"
                      variants={containerVariants}
                      initial="hidden"
                      animate="visible"
                    >
                      {activeReminders.map((reminder) => (
                        <motion.li
                          key={reminder.id}
                          variants={itemVariants}
                          exit="exit"
                          layout
                          className="flex items-center justify-between rounded-md border bg-muted/40 px-3 py-2"
                        >
                          <div className="flex items-center gap-2 text-sm">
                            <Clock className="size-4 text-muted-foreground" />
                            <span>{formatReminder(reminder, t)}</span>
                          </div>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="size-7 text-muted-foreground hover:text-destructive"
                            onClick={() => removeReminder(reminder.id)}
                          >
                            <X className="size-4" />
                            <span className="sr-only">
                              {t.common.delete}
                            </span>
                          </Button>
                        </motion.li>
                      ))}
                    </motion.ul>
                  )}
                </CardContent>
              </Card>
            </motion.div>

            {/* 5. Per-node reminder note */}
            <motion.div variants={itemVariants}>
              <Card>
                <CardContent className="pt-6">
                  <div className="flex items-start gap-3 rounded-md border border-dashed border-muted-foreground/30 bg-muted/30 p-4">
                    <Bell className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                    <p className="text-sm leading-relaxed text-muted-foreground">
                      {t.notification.addReminder}
                    </p>
                  </div>
                </CardContent>
              </Card>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}