{
  description = "Node.js development environment for the HTMX + Alpine Kanban Board";

  inputs = {
    nixpkgs.url = "github:nixos/nixpkgs?ref=nixos-unstable";
  };

  outputs = { self, nixpkgs }:
    let
      # Define supported systems for Linux and macOS
      systems = [ "x86_64-linux" "aarch64-linux" "x86_64-darwin" "aarch64-darwin" ];
      forEachSystem = nixpkgs.lib.genAttrs systems;
    in
    {
      devShells = forEachSystem (system:
        let
          pkgs = nixpkgs.legacyPackages.${system};
        in
        {
          default = pkgs.mkShell {
            # Client libraries (htmx, Alpine, SortableJS) are vendored under
            # public/vendor and served by express.static, so there is no build
            # step — Node.js is the only system-level dependency.
            packages = with pkgs; [
              nodejs_22 # This provides both `node` and `npm`
            ];

            shellHook = ''
              echo "====================================================="
              echo "Miniboard dev environment"
              echo "Node version: $(node -v)"
              echo "NPM version: $(npm -v)"
              echo "====================================================="
              echo ""
              echo "  npm install   # once, after a fresh clone"
              echo "  npm run dev   # http://localhost:3000"
              echo "  npm test      # node:test suite"
              echo ""
            '';
          };
        }
      );
    };
}