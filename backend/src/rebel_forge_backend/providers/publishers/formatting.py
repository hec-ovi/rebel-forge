PLATFORM_ALIASES = {
    "twitter": "x",
    "fb": "facebook",
    "ig": "instagram",
}

PLATFORM_CHARACTER_LIMITS = {
    "x": (280, 5),
    "linkedin": (3000, 10),
    "facebook": (63206, 10),
    "instagram": (2200, 30),
    "threads": (500, 10),
}


def canonical_platform(platform: str) -> str:
    normalized = platform.strip().lower()
    return PLATFORM_ALIASES.get(normalized, normalized)


def format_platform_post(platform: str, caption: str, hashtags: list[str]) -> str:
    """Format a post and reject content that exceeds the platform limit."""
    canonical = canonical_platform(platform)
    if canonical not in PLATFORM_CHARACTER_LIMITS:
        raise ValueError(f"Unsupported publishing platform: {platform}")
    max_characters, hashtag_limit = PLATFORM_CHARACTER_LIMITS[canonical]
    if len(hashtags) > hashtag_limit:
        raise ValueError(
            f"{canonical} post has {len(hashtags)} hashtags; maximum is {hashtag_limit}."
        )
    tags = " ".join(f"#{tag.lstrip('#')}" for tag in hashtags)
    text = f"{caption}\n\n{tags}" if tags else caption
    if len(text) > max_characters:
        raise ValueError(
            f"{canonical} post is {len(text)} characters; maximum is {max_characters}."
        )
    return text
