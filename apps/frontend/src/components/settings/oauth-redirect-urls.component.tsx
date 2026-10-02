'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { useFetch } from '@gitroom/helpers/utils/custom.fetch';
import { Textarea } from '@gitroom/react/form/textarea';
import { Button } from '@gitroom/react/form/button';
import { useToaster } from '@gitroom/react/toaster/toaster';
import { useT } from '@gitroom/react/translation/get.transation.service.client';

const OAuthRedirectUrlsComponent = () => {
  const fetch = useFetch();
  const toaster = useToaster();
  const t = useT();
  const [value, setValue] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetch('/settings/oauth-redirect-urls')
      .then((response) => response.json())
      .then((data) => setValue((data.allowedOAuthRedirectUrls || []).join('\n')))
      .finally(() => setLoading(false));
  }, [fetch]);

  const save = useCallback(async () => {
    setSaving(true);
    try {
      const urls = value
        .split('\n')
        .map((url) => url.trim())
        .filter(Boolean);
      const response = await fetch('/settings/oauth-redirect-urls', {
        method: 'POST',
        body: JSON.stringify({ urls }),
      });
      if (!response.ok) {
        const error = await response.json().catch(() => ({}));
        throw new Error(error.message || 'Could not save OAuth redirect URLs');
      }
      const data = await response.json();
      setValue((data.allowedOAuthRedirectUrls || []).join('\n'));
      toaster.show(t('settings_updated', 'Settings updated'), 'success');
    } catch (error: any) {
      toaster.show(error.message, 'warning');
    } finally {
      setSaving(false);
    }
  }, [fetch, t, toaster, value]);

  return (
    <div className="my-[16px] mt-[16px] bg-sixth border-fifth border rounded-[4px] p-[24px] flex flex-col gap-[16px]">
      <div className="mt-[4px]">
        {t('oauth_redirect_urls', 'OAuth / API')}
      </div>
      <div className="text-[14px]">
        {t('allowed_oauth_redirect_urls', 'Allowed OAuth Redirect URLs')}
      </div>
      <div className="text-[12px] text-customColor18">
        {t(
          'allowed_oauth_redirect_urls_description',
          'Only these URLs may be used as redirectUrl when starting a social OAuth connection through the Public API. Enter one absolute URL per line.'
        )}
      </div>
      <Textarea
        name="allowedOAuthRedirectUrls"
        label=""
        disableForm={true}
        value={value}
        onChange={(event) => setValue(event.target.value)}
        placeholder="https://client.example.com/oauth/callback"
        disabled={loading || saving}
      />
      <Button onClick={save} loading={saving} disabled={loading}>
        {t('save', 'Save')}
      </Button>
    </div>
  );
};

export default OAuthRedirectUrlsComponent;
