import { useState } from 'react';
import { ActivityIndicator, Alert, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { router } from 'expo-router';
import { api } from '../lib/api';
import { useStore } from '../lib/store';
import { useT } from '../lib/i18n';
import { colors, radius, space } from '../theme';

/** Settings → Move to a new install: make a recovery code on the old install, enter it on the new one (docs/transfer.md). */
export default function TransferScreen() {
  const t = useT();
  const { restoreFromCode } = useStore();
  const [code, setCode] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [entry, setEntry] = useState('');
  const [busy, setBusy] = useState(false);

  const tell = (title: string, msg?: string) => (Platform.OS === 'web' ? window.alert(msg ? `${title}\n${msg}` : title) : Alert.alert(title, msg));

  const make = async () => {
    setBusy(true);
    try { setCode((await api.createTransferCode()).code); setCopied(false); }
    catch { tell(t('transfer.makeFailed')); }
    finally { setBusy(false); }
  };
  const copy = async () => {
    try { await Clipboard.setStringAsync(code!); setCopied(true); } catch { /* nothing to copy to */ }
  };
  const restore = async () => {
    setBusy(true);
    try {
      await restoreFromCode(entry);
      tell(t('transfer.done'));
      router.back();
    } catch (e) {
      const status = (e as { status?: number }).status;
      tell(t('transfer.failed'), status === 404 ? t('transfer.notFound') : status === 429 ? t('transfer.tooMany') : undefined);
    } finally { setBusy(false); }
  };
  const confirmRestore = () => {
    if (Platform.OS === 'web') { if (window.confirm(`${t('transfer.confirmTitle')}\n${t('transfer.confirmBody')}`)) restore(); }
    else Alert.alert(t('transfer.confirmTitle'), t('transfer.confirmBody'), [{ text: t('settings.cancel'), style: 'cancel' }, { text: t('transfer.restore'), onPress: restore }]);
  };

  return (
    <ScrollView contentContainerStyle={styles.page} keyboardShouldPersistTaps="handled">
      <Text style={styles.heading}>{t('transfer.makeTitle')}</Text>
      <Text style={styles.body}>{t('transfer.makeBody')}</Text>
      {code ? (
        <Pressable style={styles.codeBox} onPress={copy} accessibilityRole="button" accessibilityLabel={t('transfer.copy')}>
          <Text style={styles.code} selectable>{code}</Text>
          <Text style={styles.sub}>{copied ? t('transfer.copied') : t('transfer.copy')}</Text>
        </Pressable>
      ) : null}
      <Pressable style={styles.button} onPress={make} disabled={busy} accessibilityRole="button">
        <Text style={styles.buttonText}>{t('transfer.make')}</Text>
      </Pressable>
      <Text style={styles.sub}>{t('transfer.localNote')}</Text>

      <Text style={[styles.heading, { marginTop: space(8) }]}>{t('transfer.enterTitle')}</Text>
      <Text style={styles.body}>{t('transfer.enterBody')}</Text>
      <TextInput
        style={styles.input}
        value={entry}
        onChangeText={setEntry}
        placeholder="XXXX-XXXX-XXXX"
        placeholderTextColor={colors.textDim}
        autoCapitalize="characters"
        autoCorrect={false}
        maxLength={32}
      />
      <Pressable style={[styles.button, !entry.trim() && { opacity: 0.4 }]} onPress={confirmRestore} disabled={busy || !entry.trim()} accessibilityRole="button">
        <Text style={styles.buttonText}>{t('transfer.restore')}</Text>
      </Pressable>
      {busy ? <ActivityIndicator style={{ marginTop: space(4) }} color={colors.text} /> : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  page: { padding: space(4), gap: space(3) },
  heading: { color: colors.text, fontWeight: '800', fontSize: 18 },
  body: { color: colors.textDim, fontSize: 14, lineHeight: 20 },
  sub: { color: colors.textDim, fontSize: 12 },
  codeBox: { backgroundColor: colors.surface, borderRadius: radius.md, borderCurve: 'continuous', padding: space(4), alignItems: 'center', gap: space(1) },
  code: { color: colors.text, fontSize: 26, fontWeight: '800', letterSpacing: 2, fontVariant: ['tabular-nums'] },
  input: { backgroundColor: colors.surface, color: colors.text, borderRadius: radius.md, borderCurve: 'continuous', padding: space(3), fontSize: 18, letterSpacing: 1 },
  button: { backgroundColor: colors.hate, borderRadius: radius.md, borderCurve: 'continuous', paddingVertical: space(3), alignItems: 'center' },
  buttonText: { color: colors.onHate, fontWeight: '800', fontSize: 15 },
});
