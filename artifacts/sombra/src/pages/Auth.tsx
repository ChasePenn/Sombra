import { SignIn, SignUp } from '@clerk/react';
import { Link } from 'wouter';
import type { ReactNode } from 'react';
import { basePath, useSession } from '../lib/session';
import { modeQuery } from '../lib/copy';
import { legalUi } from '../lib/legal-copy';

function Frame({ title, sub, children }: { title: string; sub: string; children: ReactNode }) {
  const { t } = useSession();
  return (
    <main className="auth">
      <div className="auth-top">
        <Link href="/" className="brand wordmark">
          <img src={`${import.meta.env.BASE_URL}brand/sombra-icon.svg`} alt="" />
          <span>sombra</span>
        </Link>
        <Link href="/app" className="btn btn-quiet">{t.continueGuest}</Link>
      </div>
      <div className="auth-intro"><h1>{title}</h1><p>{sub}</p></div>
      {children}
    </main>
  );
}

export function SignInPage() {
  const { t } = useSession();
  return (
    <Frame title={t.signInTitle} sub={t.signInSub}>
      <SignIn routing="path" path={`${basePath}/sign-in`} signUpUrl={`${basePath}/sign-up${modeQuery}`} fallbackRedirectUrl={`${basePath}/app${modeQuery}`} />
    </Frame>
  );
}

export function SignUpPage() {
  const { t, lang } = useSession();
  const legal = legalUi[lang];
  return (
    <Frame title={t.signUpTitle} sub={t.signUpSub}>
      <SignUp routing="path" path={`${basePath}/sign-up`} signInUrl={`${basePath}/sign-in${modeQuery}`} fallbackRedirectUrl={`${basePath}/app${modeQuery}`} />
      <p className="legal-agree">{legal.agree} <Link href="/terms">{legal.terms}</Link> · <Link href="/privacy">{legal.privacy}</Link></p>
    </Frame>
  );
}
