from rebel_forge_backend.api.auth import get_token_file, get_tokens


def main() -> None:
    """Print local bootstrap tokens to the operator's terminal."""
    tokens = get_tokens()
    print(f"Token file: {get_token_file()}")
    print(f"Owner token: {tokens['owner']}")
    print(f"Viewer token: {tokens['viewer']}")


if __name__ == "__main__":
    main()
