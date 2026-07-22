import base64

ENCODED_VALUE_PREFIX = "rebel-forge-base64:"


def encode_env_value(value: str) -> str:
    """Encode values that dotenv parsers could quote, expand, or split differently."""
    if not any(character.isspace() or character in "#$'\"\\" for character in value):
        return value
    encoded = base64.urlsafe_b64encode(value.encode()).decode()
    return f"{ENCODED_VALUE_PREFIX}{encoded}"


def decode_env_value(value: str) -> str:
    if not value.startswith(ENCODED_VALUE_PREFIX):
        return value
    encoded = value.removeprefix(ENCODED_VALUE_PREFIX)
    try:
        return base64.urlsafe_b64decode(encoded.encode()).decode()
    except (ValueError, UnicodeDecodeError):
        return value
