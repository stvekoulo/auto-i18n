// Composant fictif utilisé uniquement comme fixture de test.
// Il ne s'agit PAS d'un vrai composant React exécutable.

import React from 'react';

interface Props {
  name: string;
  count: number;
  isAdmin: boolean;
}

export function TestComponent({ name, count, isAdmin }: Props) {
  // Template literal simple
  const pageTitle = `Tableau de bord`;

  // Template literal dynamique
  const greeting = `Bonjour ${name}, vous avez ${count} messages`;

  // Template literal déjà traduit — doit être ignoré
  const translated = t(`already_translated`);

  // String purement technique — doit être ignorée par le filtre
  const layout = 'flex items-center justify-between';
  const route = '/dashboard';
  const method = 'POST';
  const size = '16px';
  const color = '#3b82f6';
  const num = '42';

  return (
    <div className="flex flex-col gap-4">
      {/* Texte JSX — doit être extrait */}
      <h1>Bienvenue sur la plateforme</h1>
      <p>Gérez vos projets facilement</p>

      {/* Texte JSX déjà traduit — doit être ignoré */}
      <span>{t('existing_key')}</span>

      {/* Attribut traduisible — doit être extrait */}
      <input placeholder="Rechercher un projet" type="text" />
      <img src="/logo.png" alt="Logo de l'application" />
      <button title="Fermer la fenêtre">X</button>
      <div aria-label="Zone de navigation principale">Nav</div>

      {/* Attribut non traduisible — ne doit PAS être extrait */}
      <a href="/profil" className="text-blue-500">Profil</a>
      <form method="POST" action="/submit">
        <input type="email" name="email" id="user-email" />
      </form>

      {/* Utilisation des variables calculées */}
      <h2>{pageTitle}</h2>
      <p>{greeting}</p>
      <p>{translated}</p>

      {isAdmin && <p>Accès administrateur activé</p>}
    </div>
  );
}
