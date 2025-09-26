// SecretSource abstraction: only this module is allowed to touch process.env
export class SecretSource {
  // Returns string | undefined; callers coerce with defaults/parsers
  get(_name) {
    return undefined;
  }
}

export class EnvSecretSource extends SecretSource {
  get(name) {
    return process.env?.[name];
  }
}
